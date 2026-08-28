//! Durable Code-mode orchestration.
//!
//! This crate is independent from Tauri. It owns the run/task state machine,
//! scheduler, worktree lifecycle, structured Codex worker processes, and the
//! authenticated event boundary. The desktop host adapts it to commands and
//! channels.

use agentic_super_app_code_domain::{
    adaptive_concurrency_cap, ready_orchestration_task_ids, validate_orchestration_dag,
    validate_orchestration_text, CodeDomainError,
};
use agentic_super_app_git_service::{AgenticSuperAppGitError, AgenticSuperAppGitService};
use agentic_super_app_persistence::AgenticSuperAppPersistence;
use agentic_super_app_protocol::CodeWorkspaceCapability;
use agentic_super_app_protocol::{
    CodeCheckpoint, CodeCheckpointDiffRequest, CodeCheckpointKind, CodeCheckpointState,
    CodeCleanupConfirmRequest, CodeCleanupPreview, CodeCleanupPreviewRequest, CodeDagProposal,
    CodeDagProposalAcceptRequest, CodeDagProposalRequest, CodeDagProposalTask, CodeDispatch,
    CodeDispatchCancelRequest, CodeDispatchResumeRequest, CodeDispatchState,
    CodeDispatchTerminalRequest, CodeManagedWorktree, CodeManagedWorktreeState,
    CodeOrchestrationEventEnvelope, CodeOrchestrationEventOrigin, CodeOrchestrationMessage,
    CodeOrchestrationMessageKind, CodeQuestionAnswerRequest, CodeReview, CodeReviewDecision,
    CodeReviewPolicy, CodeReviewRequest, CodeRunCreateRequest, CodeRunRequest, CodeRunState,
    CodeRunSummary, CodeTask, CodeTaskCreateRequest, CodeTaskDependency, CodeTaskRetryRequest,
    CodeTaskState, CodeTaskUpdateRequest, CODE_ORCHESTRATION_DEFAULT_ADAPTER_ID,
};
use agentic_super_app_workspace_service::{
    AgenticSuperAppWorkspaceError, AgenticSuperAppWorkspaceService,
};
use hmac::{Hmac, Mac};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    process::{ChildStderr, ChildStdout, Command},
    sync::{broadcast, mpsc, Mutex},
    time::{sleep, timeout, Duration},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

const MAX_PROPOSAL_BYTES: usize = 128 * 1024;
const MAX_WORKER_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_EVENT_PAYLOAD_BYTES: usize = 64 * 1024;
const EVENT_CHANNEL_CAPACITY: usize = 512;
const WORKER_POLL_INTERVAL_MS: u64 = 250;
const DEFAULT_CONCURRENCY: u8 = 2;
const WORKER_STALE_AFTER_MS: i64 = 20_000;
const WORKER_CANCEL_GRACE_MS: u64 = 5_000;
const WORKER_ENVIRONMENT_ALLOWLIST: &[&str] = &[
    "PATH",
    "PATHEXT",
    "HOME",
    "USERPROFILE",
    "APPDATA",
    "LOCALAPPDATA",
    "CODEX_HOME",
    "XDG_CONFIG_HOME",
    "XDG_DATA_HOME",
    "XDG_CACHE_HOME",
    "CARGO_HOME",
    "RUSTUP_HOME",
    "TMP",
    "TEMP",
    "TMPDIR",
    "SYSTEMROOT",
    "WINDIR",
    "COMSPEC",
    "LANG",
    "LC_ALL",
    "TERM",
    "COLORTERM",
];

trait CodeWorkerAdapter: Send + Sync {
    fn id(&self) -> &'static str;
    fn supports(&self, adapter_id: &str) -> bool;
    fn command(
        &self,
        adapter_id: &str,
        worktree: &Path,
        model: Option<&str>,
        resume_session_id: Option<&str>,
    ) -> Command;
}

#[derive(Debug, Default)]
struct CliWorkerAdapter;

impl CodeWorkerAdapter for CliWorkerAdapter {
    fn id(&self) -> &'static str {
        CODE_ORCHESTRATION_DEFAULT_ADAPTER_ID
    }

    fn supports(&self, adapter_id: &str) -> bool {
        matches!(
            adapter_id,
            "codex-cli" | "claude-code" | "antigravity" | "opencode"
        )
    }

    fn command(
        &self,
        adapter_id: &str,
        worktree: &Path,
        model: Option<&str>,
        resume_session_id: Option<&str>,
    ) -> Command {
        let executable = match adapter_id {
            "claude-code" => "claude",
            "antigravity" => "agy",
            "opencode" => "opencode",
            _ => "codex",
        };
        let mut command = Command::new(executable);
        match adapter_id {
            "claude-code" => {
                command.args([
                    "-p",
                    "--output-format",
                    "stream-json",
                    "--permission-mode",
                    "acceptEdits",
                ]);
                if let Some(session_id) = resume_session_id {
                    command.args(["--resume", session_id]);
                }
            }
            "antigravity" => {
                command.args(["-p", "--output-format", "stream-json"]);
            }
            "opencode" => {
                command.args(["run", "--format", "json", "--dir"]);
                command.arg(worktree);
                if let Some(session_id) = resume_session_id {
                    command.args(["--session", session_id]);
                }
            }
            _ => {
                command
                    .arg("exec")
                    .arg("--json")
                    .arg("--cd")
                    .arg(worktree)
                    .arg("--approve-for-me");
                if resume_session_id.is_none() {
                    command.arg("--sandbox").arg("workspace-write");
                }
                if let Some(session_id) = resume_session_id {
                    command.arg("resume").arg(session_id);
                }
            }
        }
        if let Some(model) = model.filter(|value| !value.trim().is_empty() && *value != "default") {
            command.arg("--model").arg(model);
        }
        command
    }
}

#[derive(Clone)]
struct WorkerControl {
    run_id: String,
    cancellation: CancellationToken,
}

#[derive(Debug, Error)]
pub enum AgenticSuperAppCodeOrchestrationError {
    #[error("database operation failed: {0}")]
    Database(#[from] sqlx::Error),
    #[error("workspace operation failed: {0}")]
    Workspace(#[from] AgenticSuperAppWorkspaceError),
    #[error("Git operation failed: {0}")]
    Git(#[from] AgenticSuperAppGitError),
    #[error("orchestration policy rejected the request: {0}")]
    Domain(#[from] CodeDomainError),
    #[error("JSON operation failed: {0}")]
    Json(#[from] serde_json::Error),
    #[error("filesystem operation failed: {0}")]
    Io(#[from] std::io::Error),
    #[error("the requested orchestration object was not found")]
    NotFound,
    #[error("the orchestration operation is not valid in the current state: {0}")]
    InvalidState(String),
    #[error("the coding-agent executable is unavailable: {0}")]
    WorkerUnavailable(String),
    #[error("the worker process failed: {0}")]
    WorkerFailed(String),
    #[error("the worker event was rejected")]
    InvalidWorkerEvent,
    #[error("the cleanup confirmation did not match the requested worktree")]
    InvalidCleanupConfirmation,
}

pub type AgenticSuperAppCodeOrchestrationResult<T> =
    Result<T, AgenticSuperAppCodeOrchestrationError>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CodeDispatchTerminalContext {
    pub workspace_id: String,
    pub worktree_path: PathBuf,
    pub adapter_id: String,
    pub model: Option<String>,
    pub resume_session_id: Option<String>,
    pub lease_generation: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerifiedWorkerEvent {
    pub dispatch_id: String,
    pub lease_generation: u64,
    pub sequence: u64,
    pub kind: String,
    pub payload: String,
    pub nonce: String,
}

#[derive(Debug, Clone)]
struct WorkerLaunch {
    dispatch: CodeDispatch,
    worktree: CodeManagedWorktree,
    task: CodeTask,
    model: Option<String>,
    secret: Vec<u8>,
    resume_session_id: Option<String>,
    answer: Option<String>,
}

#[derive(Debug, Clone)]
struct WorkerResult {
    success: bool,
    session_id: Option<String>,
    summary: String,
    question: Option<String>,
}

#[derive(Clone)]
pub struct AgenticSuperAppCodeOrchestration {
    persistence: AgenticSuperAppPersistence,
    workspaces: AgenticSuperAppWorkspaceService,
    git: AgenticSuperAppGitService,
    data_root: Arc<PathBuf>,
    events: broadcast::Sender<CodeOrchestrationEventEnvelope>,
    scheduled_runs: Arc<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>>,
    event_lock: Arc<Mutex<()>>,
    worker_adapter: Arc<dyn CodeWorkerAdapter>,
    worker_controls: Arc<Mutex<HashMap<String, WorkerControl>>>,
}

impl AgenticSuperAppCodeOrchestration {
    pub fn new(
        persistence: AgenticSuperAppPersistence,
        workspaces: AgenticSuperAppWorkspaceService,
        data_root: PathBuf,
    ) -> Self {
        let (events, _) = broadcast::channel(EVENT_CHANNEL_CAPACITY);
        Self {
            persistence,
            workspaces,
            git: AgenticSuperAppGitService,
            data_root: Arc::new(data_root),
            events,
            scheduled_runs: Arc::new(Mutex::new(HashMap::new())),
            event_lock: Arc::new(Mutex::new(())),
            worker_adapter: Arc::new(CliWorkerAdapter),
            worker_controls: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub async fn recover(&self) -> AgenticSuperAppCodeOrchestrationResult<usize> {
        Ok(self.persistence.interrupt_active_orchestration().await?)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<CodeOrchestrationEventEnvelope> {
        self.events.subscribe()
    }

    pub async fn runs(
        &self,
        workspace_id: Option<&str>,
    ) -> AgenticSuperAppCodeOrchestrationResult<Vec<CodeRunSummary>> {
        Ok(self.persistence.orchestration_runs(workspace_id).await?)
    }

    pub async fn detail(
        &self,
        run_id: &str,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        self.persistence
            .orchestration_detail(run_id)
            .await?
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)
    }

    pub async fn create_run(
        &self,
        request: &CodeRunCreateRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        validate_orchestration_text(&request.title)?;
        validate_orchestration_text(&request.objective)?;
        self.workspaces.summary(&request.workspace_id)?;
        let adapter_id = request
            .adapter_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(self.worker_adapter.id());
        if !self.worker_adapter.supports(adapter_id) {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                format!("worker adapter {adapter_id} is not installed"),
            ));
        }
        if let Some(coordinator_id) = request
            .coordinator_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            validate_orchestration_text(coordinator_id)?;
        }
        let host_cap = adaptive_concurrency_cap(
            std::thread::available_parallelism()
                .map(|value| value.get())
                .unwrap_or(1),
            available_memory_bytes(),
        );
        let concurrency_limit = request
            .concurrency_limit
            .unwrap_or(DEFAULT_CONCURRENCY)
            .clamp(1, host_cap);
        let run_id = format!("run-{}", Uuid::now_v7());
        self.persistence
            .insert_orchestration_run(request, &run_id, host_cap, concurrency_limit)
            .await?;
        self.emit_status(&run_id, None, None, "Run created", true)
            .await?;
        self.detail(&run_id).await
    }

    pub async fn update_run(
        &self,
        run_id: &str,
        title: &str,
        objective: &str,
        review_policy: CodeReviewPolicy,
        concurrency_limit: Option<u8>,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        validate_orchestration_text(title)?;
        validate_orchestration_text(objective)?;
        let current = self.detail(run_id).await?;
        let limit = concurrency_limit
            .unwrap_or(current.summary.concurrency_limit)
            .clamp(1, current.summary.host_concurrency_cap);
        if !self
            .persistence
            .update_orchestration_run(run_id, title, objective, review_policy, limit)
            .await?
        {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "run can no longer be edited".to_owned(),
            ));
        }
        self.emit_status(run_id, None, None, "Run updated", true)
            .await?;
        self.detail(run_id).await
    }

    pub async fn create_task(
        &self,
        request: &CodeTaskCreateRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        validate_orchestration_text(&request.title)?;
        validate_orchestration_text(&request.specification)?;
        let detail = self.detail(&request.run_id).await?;
        ensure_editable_run(&detail.summary.state)?;
        if detail.tasks.len() >= agentic_super_app_code_domain::CODE_MAX_ORCHESTRATION_TASKS {
            return Err(CodeDomainError::TooManyTasks.into());
        }
        let client_id = request
            .client_id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(|value| value.trim().to_owned())
            .unwrap_or_else(|| format!("task-{}", Uuid::now_v7()));
        if detail.tasks.iter().any(|task| task.client_id == client_id) {
            return Err(CodeDomainError::DuplicateTask.into());
        }
        let task_id = format!("task-{}", Uuid::now_v7());
        let dependencies = resolve_dependency_ids(&detail.tasks, &request.depends_on, &task_id)?;
        let mut task_ids = detail
            .tasks
            .iter()
            .map(|task| task.id.clone())
            .collect::<Vec<_>>();
        task_ids.push(task_id.clone());
        let mut all_dependencies = detail.dependencies.clone();
        all_dependencies.extend(dependencies.iter().cloned());
        validate_orchestration_dag(&task_ids, &all_dependencies)?;
        let now = now_ms();
        let task = CodeTask {
            id: task_id,
            run_id: request.run_id.clone(),
            client_id,
            title: request.title.trim().to_owned(),
            specification: request.specification.trim().to_owned(),
            state: CodeTaskState::Draft,
            position: detail.tasks.len() as u32,
            active_dispatch_id: None,
            latest_checkpoint_id: None,
            base_checkpoint_id: None,
            attempt: 0,
            error: None,
            created_at_unix_ms: now,
            updated_at_unix_ms: now,
        };
        self.persistence
            .insert_orchestration_task(&task, &dependencies)
            .await?;
        self.emit_status(&request.run_id, Some(&task.id), None, "Task added", true)
            .await?;
        self.detail(&request.run_id).await
    }

    pub async fn update_task(
        &self,
        request: &CodeTaskUpdateRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        validate_orchestration_text(&request.title)?;
        validate_orchestration_text(&request.specification)?;
        let detail = self.detail(&request.run_id).await?;
        ensure_editable_run(&detail.summary.state)?;
        let existing = find_task(&detail.tasks, &request.task_id)
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
        if matches!(
            existing.state,
            CodeTaskState::Preparing
                | CodeTaskState::Running
                | CodeTaskState::AwaitingInput
                | CodeTaskState::AwaitingReview
        ) {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "active tasks cannot be edited".to_owned(),
            ));
        }
        let dependencies =
            resolve_dependency_ids(&detail.tasks, &request.depends_on, &existing.id)?;
        let mut all_dependencies = detail
            .dependencies
            .iter()
            .filter(|edge| edge.task_id != existing.id)
            .cloned()
            .collect::<Vec<_>>();
        all_dependencies.extend(dependencies.iter().cloned());
        validate_orchestration_dag(
            &detail
                .tasks
                .iter()
                .map(|task| task.id.clone())
                .collect::<Vec<_>>(),
            &all_dependencies,
        )?;
        let task = CodeTask {
            title: request.title.trim().to_owned(),
            specification: request.specification.trim().to_owned(),
            state: CodeTaskState::Draft,
            error: None,
            updated_at_unix_ms: now_ms(),
            ..existing.clone()
        };
        if !self
            .persistence
            .update_orchestration_task(&task, &dependencies)
            .await?
        {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "task can no longer be edited".to_owned(),
            ));
        }
        self.emit_status(
            &request.run_id,
            Some(&existing.id),
            None,
            "Task updated",
            true,
        )
        .await?;
        self.detail(&request.run_id).await
    }

    pub async fn delete_task(
        &self,
        run_id: &str,
        task_id: &str,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        let detail = self.detail(run_id).await?;
        ensure_editable_run(&detail.summary.state)?;
        let actual_id = find_task(&detail.tasks, task_id)
            .map(|task| task.id.clone())
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
        if !self
            .persistence
            .delete_orchestration_task(run_id, &actual_id)
            .await?
        {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "only draft tasks can be deleted".to_owned(),
            ));
        }
        self.emit_status(run_id, Some(&actual_id), None, "Task deleted", true)
            .await?;
        self.detail(run_id).await
    }

    /// Ask the structured Codex CLI for a read-only DAG proposal. A small
    /// deterministic proposal is returned when Codex is not installed or the
    /// model does not produce the requested schema; accepting a proposal is
    /// always an explicit user action.
    pub async fn propose_dag(
        &self,
        request: &CodeDagProposalRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<CodeDagProposal> {
        validate_orchestration_text(&request.objective)?;
        self.workspaces
            .require(&request.workspace_id, CodeWorkspaceCapability::ReadFiles)?;
        self.workspaces.require(
            &request.workspace_id,
            CodeWorkspaceCapability::ExecuteProcesses,
        )?;
        let root = self.workspaces.root_path(&request.workspace_id)?;
        let proposal = self
            .run_proposal_worker(&root, &request.objective, request.model.as_deref())
            .await;
        match proposal {
            Ok(proposal) => {
                validate_proposal(&proposal)?;
                Ok(proposal)
            }
            Err(_) => Ok(fallback_proposal(&request.objective)),
        }
    }

    pub async fn accept_proposal(
        &self,
        request: &CodeDagProposalAcceptRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        validate_orchestration_text(&request.proposal.objective)?;
        validate_proposal(&request.proposal)?;
        let detail = self.detail(&request.run_id).await?;
        ensure_editable_run(&detail.summary.state)?;
        if detail
            .tasks
            .iter()
            .any(|task| !matches!(task.state, CodeTaskState::Draft))
        {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "a proposal can only replace draft tasks".to_owned(),
            ));
        }
        for task in &detail.tasks {
            self.persistence
                .delete_orchestration_task(&request.run_id, &task.id)
                .await?;
        }
        let mut ids_by_client = HashMap::new();
        for proposal_task in &request.proposal.tasks {
            ids_by_client.insert(
                proposal_task.client_id.clone(),
                format!("task-{}", Uuid::now_v7()),
            );
        }
        for (position, proposal_task) in request.proposal.tasks.iter().enumerate() {
            let id = ids_by_client.get(&proposal_task.client_id).cloned().ok_or(
                AgenticSuperAppCodeOrchestrationError::InvalidState(
                    "proposal task mapping disappeared".to_owned(),
                ),
            )?;
            let dependencies = proposal_task
                .depends_on
                .iter()
                .map(|dependency| {
                    let dependency_id = ids_by_client.get(dependency).ok_or_else(|| {
                        AgenticSuperAppCodeOrchestrationError::InvalidState(format!(
                            "proposal dependency {dependency} is missing"
                        ))
                    })?;
                    Ok(CodeTaskDependency {
                        run_id: request.run_id.clone(),
                        task_id: id.clone(),
                        depends_on_task_id: dependency_id.clone(),
                    })
                })
                .collect::<AgenticSuperAppCodeOrchestrationResult<Vec<_>>>()?;
            let now = now_ms();
            self.persistence
                .insert_orchestration_task(
                    &CodeTask {
                        id,
                        run_id: request.run_id.clone(),
                        client_id: proposal_task.client_id.clone(),
                        title: proposal_task.title.trim().to_owned(),
                        specification: proposal_task.specification.trim().to_owned(),
                        state: CodeTaskState::Ready,
                        position: position as u32,
                        active_dispatch_id: None,
                        latest_checkpoint_id: None,
                        base_checkpoint_id: None,
                        attempt: 0,
                        error: None,
                        created_at_unix_ms: now,
                        updated_at_unix_ms: now,
                    },
                    &dependencies,
                )
                .await?;
        }
        self.persistence
            .save_orchestration_proposal(&request.run_id, &request.proposal)
            .await?;
        self.persistence
            .set_orchestration_run_state(&request.run_id, CodeRunState::Ready, None)
            .await?;
        self.emit_status(&request.run_id, None, None, "DAG proposal accepted", true)
            .await?;
        self.detail(&request.run_id).await
    }

    pub async fn start_run(
        &self,
        request: &CodeRunRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        let detail = self.detail(&request.run_id).await?;
        self.require_worker_capabilities(&detail.summary.workspace_id)?;
        if detail.tasks.is_empty() {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "add or accept at least one task before starting the run".to_owned(),
            ));
        }
        if matches!(
            detail.summary.state,
            CodeRunState::Completed | CodeRunState::Cancelled
        ) {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "completed and cancelled runs cannot be restarted".to_owned(),
            ));
        }
        self.ensure_source_checkpoint(&detail).await?;
        self.prepare_task_states(&detail).await?;
        self.persistence
            .set_orchestration_run_state(&request.run_id, CodeRunState::Running, None)
            .await?;
        self.emit_status(&request.run_id, None, None, "Run started", true)
            .await?;
        self.ensure_scheduler(&request.run_id).await;
        self.detail(&request.run_id).await
    }

    pub async fn pause_run(
        &self,
        request: &CodeRunRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        let detail = self.detail(&request.run_id).await?;
        if !matches!(
            detail.summary.state,
            CodeRunState::Running | CodeRunState::Ready
        ) {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "only an active run can be paused".to_owned(),
            ));
        }
        self.persistence
            .set_orchestration_run_state(&request.run_id, CodeRunState::Paused, None)
            .await?;
        self.emit_status(&request.run_id, None, None, "Run paused", true)
            .await?;
        self.detail(&request.run_id).await
    }

    pub async fn cancel_run(
        &self,
        request: &CodeRunRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        let detail = self.detail(&request.run_id).await?;
        if matches!(
            detail.summary.state,
            CodeRunState::Completed | CodeRunState::Cancelled
        ) {
            return Ok(detail);
        }
        self.persistence
            .cancel_active_orchestration(&request.run_id, "Cancelled by the user")
            .await?;
        self.cancel_workers_for_run(&request.run_id).await;
        self.persistence
            .set_orchestration_run_state(
                &request.run_id,
                CodeRunState::Cancelled,
                Some("Cancelled by the user"),
            )
            .await?;
        self.emit_status(&request.run_id, None, None, "Run cancelled", true)
            .await?;
        self.detail(&request.run_id).await
    }

    pub async fn cancel_dispatch(
        &self,
        request: &CodeDispatchCancelRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        let changed = self
            .persistence
            .cancel_orchestration_dispatch(
                &request.run_id,
                &request.task_id,
                &request.dispatch_id,
                request.lease_generation,
                "Cancelled by the user",
            )
            .await?;
        if !changed {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "the dispatch lease is stale or already terminal".to_owned(),
            ));
        }
        self.cancel_worker(&request.dispatch_id).await;
        self.emit_status(
            &request.run_id,
            Some(&request.task_id),
            Some(&request.dispatch_id),
            "Dispatch cancelled",
            true,
        )
        .await?;
        self.reconcile_run(&request.run_id).await?;
        self.detail(&request.run_id).await
    }

    pub async fn resume_dispatch(
        &self,
        request: &CodeDispatchResumeRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        let detail = self.detail(&request.run_id).await?;
        self.require_worker_capabilities(&detail.summary.workspace_id)?;
        let dispatch = detail
            .dispatches
            .iter()
            .find(|dispatch| {
                dispatch.id == request.dispatch_id
                    && dispatch.task_id == request.task_id
                    && dispatch.state == CodeDispatchState::Interrupted
                    && dispatch.lease_generation == request.lease_generation
            })
            .cloned()
            .ok_or(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "the interrupted dispatch lease is stale or unavailable".to_owned(),
            ))?;
        let task = find_task(&detail.tasks, &request.task_id)
            .cloned()
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
        let worktree = detail
            .worktrees
            .iter()
            .find(|worktree| worktree.dispatch_id == dispatch.id)
            .cloned()
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
        let Some(new_generation) = self
            .persistence
            .resume_interrupted_orchestration_dispatch(
                &request.run_id,
                &request.task_id,
                &request.dispatch_id,
                request.lease_generation,
            )
            .await?
        else {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "the interrupted dispatch lease is stale".to_owned(),
            ));
        };
        self.persistence
            .set_orchestration_run_state(&request.run_id, CodeRunState::Running, None)
            .await?;
        self.emit_status(
            &request.run_id,
            Some(&request.task_id),
            Some(&request.dispatch_id),
            "Interrupted worker resumed",
            true,
        )
        .await?;
        self.spawn_worker(WorkerLaunch {
            dispatch: CodeDispatch {
                lease_generation: new_generation,
                state: CodeDispatchState::Running,
                ..dispatch.clone()
            },
            worktree,
            task,
            model: detail.summary.model.clone(),
            secret: dispatch_secret(&dispatch.id, new_generation),
            resume_session_id: dispatch.session_id,
            answer: None,
        })
        .await;
        self.ensure_scheduler(&request.run_id).await;
        self.detail(&request.run_id).await
    }

    pub async fn dispatch_terminal_context(
        &self,
        request: &CodeDispatchTerminalRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<CodeDispatchTerminalContext> {
        let detail = self.detail(&request.run_id).await?;
        self.require_worker_capabilities(&detail.summary.workspace_id)?;
        let dispatch = detail
            .dispatches
            .iter()
            .find(|dispatch| dispatch.id == request.dispatch_id)
            .cloned()
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
        if !matches!(
            dispatch.state,
            CodeDispatchState::Preparing
                | CodeDispatchState::Running
                | CodeDispatchState::AwaitingInput
                | CodeDispatchState::Checkpointing
                | CodeDispatchState::Interrupted
        ) {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "a terminal can only be opened for a live or interrupted dispatch".to_owned(),
            ));
        }
        let worktree = detail
            .worktrees
            .iter()
            .find(|worktree| worktree.dispatch_id == dispatch.id)
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
        let worktree_path = fs::canonicalize(&worktree.path)?;
        let managed_root = fs::canonicalize(self.data_root.join("worktrees"))?;
        if !worktree_path.starts_with(&managed_root) {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "dispatch worktree is outside the managed orchestration root".to_owned(),
            ));
        }
        Ok(CodeDispatchTerminalContext {
            workspace_id: detail.summary.workspace_id,
            worktree_path,
            adapter_id: dispatch.adapter_id,
            model: detail.summary.model,
            resume_session_id: dispatch.session_id,
            lease_generation: dispatch.lease_generation,
        })
    }

    pub async fn answer_question(
        &self,
        request: &CodeQuestionAnswerRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        validate_orchestration_text(&request.answer)?;
        let detail = self.detail(&request.run_id).await?;
        self.require_worker_capabilities(&detail.summary.workspace_id)?;
        let dispatch = detail
            .dispatches
            .iter()
            .find(|dispatch| {
                dispatch.id == request.dispatch_id
                    && dispatch.task_id == request.task_id
                    && dispatch.state == CodeDispatchState::AwaitingInput
                    && dispatch.lease_generation == request.lease_generation
            })
            .cloned()
            .ok_or(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "the question lease is stale or already answered".to_owned(),
            ))?;
        let task = find_task(&detail.tasks, &request.task_id)
            .cloned()
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
        let worktree = detail
            .worktrees
            .iter()
            .find(|worktree| worktree.dispatch_id == dispatch.id)
            .cloned()
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
        let Some(new_generation) = self
            .persistence
            .resume_orchestration_dispatch(
                &request.run_id,
                &request.task_id,
                &request.dispatch_id,
                request.lease_generation,
                &request.answer,
            )
            .await?
        else {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "the question lease is stale".to_owned(),
            ));
        };
        self.emit_status(
            &request.run_id,
            Some(&request.task_id),
            Some(&request.dispatch_id),
            "Question answered; resuming worker",
            true,
        )
        .await?;
        let worker_secret = dispatch_secret(&dispatch.id, new_generation);
        let launch = WorkerLaunch {
            dispatch: CodeDispatch {
                lease_generation: new_generation,
                state: CodeDispatchState::Running,
                ..dispatch
            },
            worktree,
            task,
            model: detail.summary.model.clone(),
            secret: worker_secret,
            resume_session_id: detail
                .dispatches
                .iter()
                .find(|item| item.id == request.dispatch_id)
                .and_then(|item| item.session_id.clone()),
            answer: Some(request.answer.clone()),
        };
        self.spawn_worker(launch).await;
        self.detail(&request.run_id).await
    }

    pub async fn retry_task(
        &self,
        request: &CodeTaskRetryRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        let detail = self.detail(&request.run_id).await?;
        self.require_worker_capabilities(&detail.summary.workspace_id)?;
        let task = find_task(&detail.tasks, &request.task_id)
            .cloned()
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
        if matches!(
            task.state,
            CodeTaskState::Preparing
                | CodeTaskState::Running
                | CodeTaskState::AwaitingInput
                | CodeTaskState::AwaitingReview
        ) {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "the task is already active".to_owned(),
            ));
        }
        self.persistence
            .set_orchestration_task_state(
                &request.run_id,
                &task.id,
                CodeTaskState::Ready,
                None,
                None,
                None,
                Some(task.attempt.saturating_add(1)),
                request.reason.as_deref(),
            )
            .await?;
        self.persistence
            .set_orchestration_run_state(&request.run_id, CodeRunState::Running, None)
            .await?;
        self.emit_status(
            &request.run_id,
            Some(&task.id),
            None,
            "Task queued for retry",
            true,
        )
        .await?;
        self.ensure_scheduler(&request.run_id).await;
        self.detail(&request.run_id).await
    }

    pub async fn review_checkpoint(
        &self,
        request: &CodeReviewRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        let detail = self.detail(&request.run_id).await?;
        let task = find_task(&detail.tasks, &request.task_id)
            .cloned()
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
        let checkpoint = detail
            .checkpoints
            .iter()
            .find(|checkpoint| checkpoint.id == request.checkpoint_id)
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
        if checkpoint.task_id.as_deref() != Some(task.id.as_str()) {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "checkpoint does not belong to the requested task".to_owned(),
            ));
        }
        let review_dispatch = detail
            .dispatches
            .iter()
            .find(|dispatch| task.active_dispatch_id.as_deref() == Some(dispatch.id.as_str()))
            .cloned()
            .ok_or(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "checkpoint has no active dispatch lease".to_owned(),
            ))?;
        let review = CodeReview {
            id: format!("review-{}", Uuid::now_v7()),
            run_id: request.run_id.clone(),
            task_id: task.id.clone(),
            checkpoint_id: request.checkpoint_id.clone(),
            decision: request.decision,
            feedback: request.feedback.clone(),
            created_at_unix_ms: now_ms(),
        };
        self.persistence
            .insert_orchestration_review(&review)
            .await?;
        match request.decision {
            CodeReviewDecision::Accept => {
                self.persistence
                    .set_orchestration_task_result(
                        &request.run_id,
                        &task.id,
                        &review_dispatch.id,
                        review_dispatch.lease_generation,
                        CodeTaskState::Completed,
                        Some(&request.checkpoint_id),
                        None,
                    )
                    .await?;
                self.persistence
                    .set_orchestration_run_state(&request.run_id, CodeRunState::Running, None)
                    .await?;
            }
            CodeReviewDecision::RequestChanges => {
                self.persistence
                    .set_orchestration_task_state(
                        &request.run_id,
                        &task.id,
                        CodeTaskState::Ready,
                        None,
                        None,
                        Some(&request.checkpoint_id),
                        Some(task.attempt.saturating_add(1)),
                        request.feedback.as_deref(),
                    )
                    .await?;
                self.persistence
                    .set_orchestration_run_state(&request.run_id, CodeRunState::Running, None)
                    .await?;
            }
            CodeReviewDecision::Reject => {
                self.persistence
                    .set_orchestration_task_result(
                        &request.run_id,
                        &task.id,
                        &review_dispatch.id,
                        review_dispatch.lease_generation,
                        CodeTaskState::Failed,
                        Some(&request.checkpoint_id),
                        request.feedback.as_deref().or(Some("Checkpoint rejected")),
                    )
                    .await?;
                self.persistence
                    .set_orchestration_run_state(
                        &request.run_id,
                        CodeRunState::Failed,
                        request.feedback.as_deref().or(Some("Checkpoint rejected")),
                    )
                    .await?;
            }
        }
        self.emit_status(
            &request.run_id,
            Some(&task.id),
            None,
            "Review recorded",
            true,
        )
        .await?;
        if matches!(
            request.decision,
            CodeReviewDecision::Accept | CodeReviewDecision::RequestChanges
        ) {
            self.ensure_scheduler(&request.run_id).await;
        }
        self.detail(&request.run_id).await
    }

    pub async fn cleanup_preview(
        &self,
        request: &CodeCleanupPreviewRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<CodeCleanupPreview> {
        let detail = self.detail(&request.run_id).await?;
        self.workspaces.require(
            &detail.summary.workspace_id,
            CodeWorkspaceCapability::ReadGit,
        )?;
        let worktree = detail
            .worktrees
            .iter()
            .find(|worktree| worktree.id == request.worktree_id)
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
        let root = self.workspaces.root_path(&detail.summary.workspace_id)?;
        let name = worktree_name(&worktree.path);
        let inspection = self.git.inspect_worktree(&root, &name)?;
        let can_remove = !inspection.locked && inspection.dirty_files.is_empty();
        let reason = if inspection.locked {
            Some("The worker lease still holds this worktree".to_owned())
        } else {
            inspection
                .dirty_files
                .first()
                .map(|path| format!("Uncommitted file: {path}"))
        };
        Ok(CodeCleanupPreview {
            worktree_id: worktree.id.clone(),
            path: inspection.path.to_string_lossy().into_owned(),
            branch: worktree.branch.clone(),
            dirty_files: inspection.dirty_files,
            locked: inspection.locked,
            can_remove,
            reason,
        })
    }

    pub async fn checkpoint_diff(
        &self,
        request: &CodeCheckpointDiffRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeGitDiff> {
        let detail = self.detail(&request.run_id).await?;
        self.workspaces.require(
            &detail.summary.workspace_id,
            CodeWorkspaceCapability::ReadGit,
        )?;
        let checkpoint = detail
            .checkpoints
            .iter()
            .find(|checkpoint| checkpoint.id == request.checkpoint_id)
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
        let compare = request
            .compare_to_checkpoint_id
            .as_deref()
            .or(checkpoint.parent_checkpoint_id.as_deref())
            .ok_or_else(|| {
                AgenticSuperAppCodeOrchestrationError::InvalidState(
                    "the checkpoint has no comparison base".to_owned(),
                )
            })?;
        let from = detail
            .checkpoints
            .iter()
            .find(|candidate| candidate.id == compare)
            .and_then(|candidate| candidate.commit_oid.as_deref())
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
        let to = checkpoint.commit_oid.as_deref().ok_or_else(|| {
            AgenticSuperAppCodeOrchestrationError::InvalidState(
                "checkpoint has no commit".to_owned(),
            )
        })?;
        let root = self.workspaces.root_path(&detail.summary.workspace_id)?;
        let mut diff = self.git.checkpoint_diff(&root, from, to)?;
        diff.workspace_id = detail.summary.workspace_id;
        Ok(diff)
    }

    pub async fn cleanup_confirm(
        &self,
        request: &CodeCleanupConfirmRequest,
    ) -> AgenticSuperAppCodeOrchestrationResult<agentic_super_app_protocol::CodeRunDetail> {
        let detail = self.detail(&request.run_id).await?;
        self.workspaces.require(
            &detail.summary.workspace_id,
            CodeWorkspaceCapability::WriteFiles,
        )?;
        self.workspaces.require(
            &detail.summary.workspace_id,
            CodeWorkspaceCapability::ReadGit,
        )?;
        let worktree = detail
            .worktrees
            .iter()
            .find(|worktree| worktree.id == request.worktree_id)
            .cloned()
            .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
        let expected = format!("REMOVE {}", worktree.id);
        if request.confirmation.trim() != expected {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidCleanupConfirmation);
        }
        if request.force {
            if let Some(dispatch) = detail
                .dispatches
                .iter()
                .find(|dispatch| dispatch.id == worktree.dispatch_id)
            {
                if matches!(
                    dispatch.state,
                    CodeDispatchState::Preparing
                        | CodeDispatchState::Running
                        | CodeDispatchState::AwaitingInput
                        | CodeDispatchState::Checkpointing
                ) {
                    let _ = self
                        .persistence
                        .cancel_orchestration_dispatch(
                            &request.run_id,
                            &worktree.task_id,
                            &dispatch.id,
                            dispatch.lease_generation,
                            "Cancelled before forced worktree cleanup",
                        )
                        .await?;
                    self.cancel_worker(&dispatch.id).await;
                }
            }
        }
        let root = self.workspaces.root_path(&detail.summary.workspace_id)?;
        self.git.remove_worktree(
            &root,
            &worktree_name(&worktree.path),
            &self.data_root.join("worktrees"),
            request.force,
        )?;
        self.persistence
            .update_orchestration_worktree(
                &worktree.id,
                CodeManagedWorktreeState::Removed,
                false,
                false,
                None,
            )
            .await?;
        self.emit_status(
            &request.run_id,
            Some(&worktree.task_id),
            None,
            "Worktree removed",
            true,
        )
        .await?;
        self.detail(&request.run_id).await
    }

    pub fn verify_worker_event(
        secret: &[u8],
        event_json: &str,
    ) -> AgenticSuperAppCodeOrchestrationResult<VerifiedWorkerEvent> {
        let event: BridgeEvent = serde_json::from_str(event_json)?;
        if event.dispatch_id.is_empty()
            || event.dispatch_id.len() > 128
            || event.kind.len() > 64
            || event.payload.len() > MAX_EVENT_PAYLOAD_BYTES
            || event.nonce.is_empty()
            || event.nonce.len() > 128
            || event.mac.len() > 128
        {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidWorkerEvent);
        }
        let canonical = format!(
            "{}\n{}\n{}\n{}\n{}\n{}",
            event.dispatch_id,
            event.lease_generation,
            event.sequence,
            event.kind,
            event.payload,
            event.nonce
        );
        let mut mac = HmacSha256::new_from_slice(secret)
            .map_err(|_| AgenticSuperAppCodeOrchestrationError::InvalidWorkerEvent)?;
        mac.update(canonical.as_bytes());
        let supplied = hex_decode(&event.mac)?;
        if mac.verify_slice(&supplied).is_err() {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidWorkerEvent);
        }
        Ok(VerifiedWorkerEvent {
            dispatch_id: event.dispatch_id,
            lease_generation: event.lease_generation,
            sequence: event.sequence,
            kind: event.kind,
            payload: event.payload,
            nonce: event.nonce,
        })
    }

    async fn run_proposal_worker(
        &self,
        root: &Path,
        objective: &str,
        model: Option<&str>,
    ) -> AgenticSuperAppCodeOrchestrationResult<CodeDagProposal> {
        fs::create_dir_all(self.data_root.as_path())?;
        let schema_path = self
            .data_root
            .join(format!("proposal-schema-{}.json", Uuid::now_v7()));
        let schema = r#"{
          "type":"object",
          "additionalProperties":false,
          "required":["objective","tasks","warnings"],
          "properties":{
            "objective":{"type":"string"},
            "warnings":{"type":"array","items":{"type":"string"}},
            "tasks":{"type":"array","maxItems":128,"items":{
              "type":"object","additionalProperties":false,
              "required":["client_id","title","specification","depends_on"],
              "properties":{
                "client_id":{"type":"string"},
                "title":{"type":"string"},
                "specification":{"type":"string"},
                "depends_on":{"type":"array","items":{"type":"string"}}
              }
            }}
          }
        }"#;
        fs::write(&schema_path, schema)?;
        let prompt = format!(
            "Plan this coding objective as a small deterministic DAG. Do not edit files.\n\nObjective:\n{objective}\n\nReturn only the requested structured proposal. Keep task specifications actionable, bounded, and independent where possible."
        );
        let mut command = Command::new("codex");
        configure_worker_environment(&mut command);
        command
            .arg("exec")
            .arg("--json")
            .arg("--ephemeral")
            .arg("--sandbox")
            .arg("read-only")
            .arg("--cd")
            .arg(root)
            .arg("--output-schema")
            .arg(&schema_path);
        if let Some(model) = model.filter(|value| !value.trim().is_empty()) {
            command.arg("--model").arg(model);
        }
        let output = command.arg(prompt).output().await;
        let _ = fs::remove_file(&schema_path);
        let output = output.map_err(|error| {
            AgenticSuperAppCodeOrchestrationError::WorkerUnavailable(error.to_string())
        })?;
        if !output.status.success() {
            return Err(AgenticSuperAppCodeOrchestrationError::WorkerFailed(
                String::from_utf8_lossy(&output.stderr).trim().to_owned(),
            ));
        }
        parse_proposal_output(&String::from_utf8_lossy(&output.stdout)).ok_or_else(|| {
            AgenticSuperAppCodeOrchestrationError::WorkerFailed(
                "Codex returned no valid DAG proposal".to_owned(),
            )
        })
    }

    async fn ensure_source_checkpoint(
        &self,
        detail: &agentic_super_app_protocol::CodeRunDetail,
    ) -> AgenticSuperAppCodeOrchestrationResult<CodeCheckpoint> {
        if let Some(checkpoint) = detail
            .checkpoints
            .iter()
            .find(|checkpoint| checkpoint.kind == CodeCheckpointKind::Source)
        {
            return Ok(checkpoint.clone());
        }
        let root = self.workspaces.root_path(&detail.summary.workspace_id)?;
        let commit_oid = self.git.head_oid(&root)?;
        let checkpoint = CodeCheckpoint {
            id: format!("checkpoint-{}", Uuid::now_v7()),
            run_id: detail.summary.id.clone(),
            task_id: None,
            dispatch_id: None,
            kind: CodeCheckpointKind::Source,
            state: CodeCheckpointState::Ready,
            ref_name: format!("agentic-super-app/source/{}", short_id(&detail.summary.id)),
            commit_oid: Some(commit_oid),
            parent_checkpoint_id: None,
            summary: "Workspace HEAD captured as orchestration source".to_owned(),
            created_at_unix_ms: now_ms(),
        };
        self.persistence
            .insert_orchestration_checkpoint(&checkpoint)
            .await?;
        self.persistence
            .set_orchestration_source_checkpoint(&detail.summary.id, &checkpoint.id)
            .await?;
        self.emit_status(
            &detail.summary.id,
            None,
            None,
            "Source checkpoint captured",
            true,
        )
        .await?;
        Ok(checkpoint)
    }

    async fn prepare_task_states(
        &self,
        detail: &agentic_super_app_protocol::CodeRunDetail,
    ) -> AgenticSuperAppCodeOrchestrationResult<()> {
        for task in &detail.tasks {
            if task.state == CodeTaskState::Draft {
                self.persistence
                    .set_orchestration_task_state(
                        &detail.summary.id,
                        &task.id,
                        CodeTaskState::Ready,
                        None,
                        None,
                        None,
                        None,
                        None,
                    )
                    .await?;
            }
        }
        Ok(())
    }

    async fn ensure_scheduler(&self, run_id: &str) {
        let mut scheduled = self.scheduled_runs.lock().await;
        if scheduled.contains_key(run_id) {
            return;
        }
        let service = self.clone();
        let id = run_id.to_owned();
        let handle = tokio::spawn(async move {
            service.scheduler_loop(id.clone()).await;
            service.scheduled_runs.lock().await.remove(&id);
        });
        scheduled.insert(run_id.to_owned(), handle);
    }

    async fn scheduler_loop(&self, run_id: String) {
        while let Ok(true) = self.schedule_once(&run_id).await {
            sleep(Duration::from_millis(WORKER_POLL_INTERVAL_MS)).await;
        }
    }

    async fn schedule_once(&self, run_id: &str) -> AgenticSuperAppCodeOrchestrationResult<bool> {
        let stale_dispatches = self
            .persistence
            .mark_stale_orchestration_dispatches(run_id, now_ms() - WORKER_STALE_AFTER_MS)
            .await?;
        for dispatch_id in stale_dispatches {
            self.emit_status(
                run_id,
                None,
                Some(&dispatch_id),
                "Worker heartbeat expired; dispatch marked stale",
                false,
            )
            .await?;
        }
        let detail = self.detail(run_id).await?;
        if detail.summary.state != CodeRunState::Running {
            return Ok(false);
        }
        let active = detail
            .dispatches
            .iter()
            .filter(|dispatch| {
                matches!(
                    dispatch.state,
                    CodeDispatchState::Preparing
                        | CodeDispatchState::Running
                        | CodeDispatchState::AwaitingInput
                        | CodeDispatchState::Checkpointing
                )
            })
            .count();
        let cap = usize::from(
            detail
                .summary
                .concurrency_limit
                .min(detail.summary.host_concurrency_cap),
        );
        if active >= cap {
            return Ok(true);
        }
        let available = cap - active;
        let ready = ready_orchestration_task_ids(&detail.tasks, &detail.dependencies);
        for task_id in ready.into_iter().take(available) {
            let current = self.detail(run_id).await?;
            let Some(task) = current
                .tasks
                .iter()
                .find(|task| task.id == task_id)
                .cloned()
            else {
                continue;
            };
            if let Err(error) = self.prepare_and_launch(current, task).await {
                self.emit_status(run_id, Some(&task_id), None, &error.to_string(), false)
                    .await?;
            }
        }
        self.reconcile_run(run_id).await?;
        Ok(true)
    }

    async fn prepare_and_launch(
        &self,
        detail: agentic_super_app_protocol::CodeRunDetail,
        task: CodeTask,
    ) -> AgenticSuperAppCodeOrchestrationResult<()> {
        let attempt = task.attempt.saturating_add(1);
        let dispatch = CodeDispatch {
            id: format!("dispatch-{}", Uuid::now_v7()),
            run_id: detail.summary.id.clone(),
            task_id: task.id.clone(),
            attempt,
            state: CodeDispatchState::Preparing,
            adapter_id: detail.summary.adapter_id.clone(),
            lease_generation: 1,
            session_id: None,
            pid: None,
            worktree_id: None,
            checkpoint_id: None,
            last_heartbeat_at_unix_ms: Some(now_ms()),
            terminal_id: None,
            cancel_requested_at_unix_ms: None,
            started_at_unix_ms: now_ms(),
            updated_at_unix_ms: now_ms(),
            error: None,
            result_summary: None,
        };
        if !self
            .persistence
            .claim_orchestration_dispatch(&dispatch)
            .await?
        {
            return Ok(());
        }
        let base = match self.resolve_base_checkpoint(&detail, &task).await {
            Ok(base) => base,
            Err(error) => {
                let message = error.to_string();
                if matches!(
                    &error,
                    AgenticSuperAppCodeOrchestrationError::Git(
                        AgenticSuperAppGitError::MergeConflict(_)
                    )
                ) {
                    self.block_dispatch(&dispatch, &task, &message).await?;
                    return Ok(());
                }
                self.fail_dispatch(&dispatch, &task, &message).await?;
                return Err(error);
            }
        };
        let workspace_root = self.workspaces.root_path(&detail.summary.workspace_id)?;
        let worktree_name = format!(
            "orchestration-{}-{}-{}",
            short_id(&detail.summary.id),
            short_id(&task.id),
            attempt
        );
        let worktree_path = self.data_root.join("worktrees").join(&worktree_name);
        let branch = format!(
            "agentic/{}/{}-{}",
            short_id(&detail.summary.id),
            short_id(&task.id),
            attempt
        );
        let created = match self.git.create_worktree(
            &workspace_root,
            &worktree_name,
            &worktree_path,
            &branch,
            base.commit_oid.as_deref().ok_or_else(|| {
                AgenticSuperAppCodeOrchestrationError::InvalidState(
                    "base checkpoint has no commit".to_owned(),
                )
            })?,
        ) {
            Ok(created) => created,
            Err(error) => {
                self.fail_dispatch(&dispatch, &task, &error.to_string())
                    .await?;
                return Err(error.into());
            }
        };
        let worktree = CodeManagedWorktree {
            id: format!("worktree-{}", Uuid::now_v7()),
            run_id: detail.summary.id.clone(),
            task_id: task.id.clone(),
            dispatch_id: dispatch.id.clone(),
            path: created.path.to_string_lossy().into_owned(),
            branch: created.branch,
            base_checkpoint_id: Some(base.id.clone()),
            state: CodeManagedWorktreeState::Ready,
            dirty: false,
            locked: true,
            error: None,
            created_at_unix_ms: now_ms(),
            updated_at_unix_ms: now_ms(),
        };
        self.persistence
            .insert_orchestration_worktree(&worktree)
            .await?;
        self.persistence
            .set_orchestration_task_state(
                &detail.summary.id,
                &task.id,
                CodeTaskState::Preparing,
                Some(&dispatch.id),
                Some(&base.id),
                None,
                Some(attempt),
                None,
            )
            .await?;
        self.persistence
            .update_orchestration_dispatch(
                &dispatch.id,
                dispatch.lease_generation,
                CodeDispatchState::Running,
                None,
                None,
                Some(&worktree.id),
                None,
                Some(now_ms()),
                None,
                None,
            )
            .await?;
        self.persistence
            .set_orchestration_task_state(
                &detail.summary.id,
                &task.id,
                CodeTaskState::Running,
                Some(&dispatch.id),
                Some(&base.id),
                None,
                Some(attempt),
                None,
            )
            .await?;
        self.emit_status(
            &detail.summary.id,
            Some(&task.id),
            Some(&dispatch.id),
            "Worker started",
            true,
        )
        .await?;
        let worker_secret = dispatch_secret(&dispatch.id, dispatch.lease_generation);
        self.spawn_worker(WorkerLaunch {
            dispatch,
            worktree,
            task: CodeTask {
                base_checkpoint_id: Some(base.id),
                attempt,
                ..task
            },
            model: detail.summary.model.clone(),
            secret: worker_secret,
            resume_session_id: None,
            answer: None,
        })
        .await;
        Ok(())
    }

    async fn resolve_base_checkpoint(
        &self,
        detail: &agentic_super_app_protocol::CodeRunDetail,
        task: &CodeTask,
    ) -> AgenticSuperAppCodeOrchestrationResult<CodeCheckpoint> {
        let source = detail
            .checkpoints
            .iter()
            .find(|checkpoint| checkpoint.kind == CodeCheckpointKind::Source)
            .cloned()
            .ok_or_else(|| {
                AgenticSuperAppCodeOrchestrationError::InvalidState(
                    "the run has no source checkpoint".to_owned(),
                )
            })?;
        let dependency_ids = detail
            .dependencies
            .iter()
            .filter(|edge| edge.task_id == task.id)
            .map(|edge| edge.depends_on_task_id.as_str())
            .collect::<Vec<_>>();
        let mut checkpoints = Vec::new();
        for dependency_id in dependency_ids {
            let dependency = detail
                .tasks
                .iter()
                .find(|candidate| candidate.id == dependency_id)
                .ok_or_else(|| CodeDomainError::MissingTask(dependency_id.to_owned()))?;
            let checkpoint_id = dependency.latest_checkpoint_id.as_deref().ok_or_else(|| {
                AgenticSuperAppCodeOrchestrationError::InvalidState(format!(
                    "dependency {} completed without a checkpoint",
                    dependency.client_id
                ))
            })?;
            let checkpoint = detail
                .checkpoints
                .iter()
                .find(|candidate| candidate.id == checkpoint_id)
                .cloned()
                .ok_or(AgenticSuperAppCodeOrchestrationError::NotFound)?;
            checkpoints.push(checkpoint);
        }
        if checkpoints.is_empty() {
            return Ok(source);
        }
        if checkpoints.len() == 1 {
            return Ok(checkpoints.remove(0));
        }
        let mut commit_oids = checkpoints
            .iter()
            .filter_map(|checkpoint| checkpoint.commit_oid.clone())
            .collect::<Vec<_>>();
        if commit_oids.len() != checkpoints.len() {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
                "a dependency checkpoint has no commit".to_owned(),
            ));
        }
        commit_oids.sort();
        let integration_key = short_hash(
            &commit_oids
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>()
                .join("\n"),
        );
        let ref_name = format!(
            "agentic-super-app/integration/{}/{}",
            short_id(&detail.summary.id),
            integration_key
        );
        if let Some(existing) = detail
            .checkpoints
            .iter()
            .find(|checkpoint| checkpoint.ref_name == ref_name)
        {
            return Ok(existing.clone());
        }
        let root = self.workspaces.root_path(&detail.summary.workspace_id)?;
        let merged = self.git.merge_checkpoints(
            &root,
            source.commit_oid.as_deref().ok_or_else(|| {
                AgenticSuperAppCodeOrchestrationError::InvalidState(
                    "source checkpoint has no commit".to_owned(),
                )
            })?,
            &commit_oids,
            &format!("refs/heads/{ref_name}"),
            "orchestration dependency fan-in",
        )?;
        let checkpoint = CodeCheckpoint {
            id: format!("checkpoint-{}", Uuid::now_v7()),
            run_id: detail.summary.id.clone(),
            task_id: None,
            dispatch_id: None,
            kind: CodeCheckpointKind::Integration,
            state: CodeCheckpointState::Ready,
            ref_name,
            commit_oid: Some(merged.commit_oid),
            parent_checkpoint_id: Some(source.id),
            summary: "Accepted dependency checkpoints integrated for fan-in".to_owned(),
            created_at_unix_ms: now_ms(),
        };
        self.persistence
            .insert_orchestration_checkpoint(&checkpoint)
            .await?;
        Ok(checkpoint)
    }

    async fn fail_dispatch(
        &self,
        dispatch: &CodeDispatch,
        task: &CodeTask,
        error: &str,
    ) -> AgenticSuperAppCodeOrchestrationResult<()> {
        let task_updated = self
            .persistence
            .set_orchestration_task_result(
                &dispatch.run_id,
                &task.id,
                &dispatch.id,
                dispatch.lease_generation,
                CodeTaskState::Failed,
                None,
                Some(error),
            )
            .await?;
        let dispatch_updated = self
            .persistence
            .update_orchestration_dispatch(
                &dispatch.id,
                dispatch.lease_generation,
                CodeDispatchState::Failed,
                None,
                None,
                None,
                None,
                Some(now_ms()),
                Some(error),
                None,
            )
            .await?;
        if dispatch_updated && task_updated {
            self.persistence
                .set_orchestration_run_state(&dispatch.run_id, CodeRunState::Failed, Some(error))
                .await?;
        }
        Ok(())
    }

    async fn block_dispatch(
        &self,
        dispatch: &CodeDispatch,
        task: &CodeTask,
        error: &str,
    ) -> AgenticSuperAppCodeOrchestrationResult<()> {
        let dispatch_updated = self
            .persistence
            .update_orchestration_dispatch(
                &dispatch.id,
                dispatch.lease_generation,
                CodeDispatchState::Failed,
                None,
                None,
                None,
                None,
                Some(now_ms()),
                Some(error),
                None,
            )
            .await?;
        if !dispatch_updated {
            return Ok(());
        }
        self.persistence
            .set_orchestration_task_state(
                &dispatch.run_id,
                &task.id,
                CodeTaskState::Blocked,
                None,
                None,
                None,
                None,
                Some(error),
            )
            .await?;
        self.persistence
            .set_orchestration_run_state(
                &dispatch.run_id,
                CodeRunState::Blocked,
                Some("Dependency fan-in requires conflict resolution"),
            )
            .await?;
        self.emit_status(
            &dispatch.run_id,
            Some(&task.id),
            Some(&dispatch.id),
            "Dependency fan-in conflict; task blocked",
            false,
        )
        .await?;
        Ok(())
    }

    fn require_worker_capabilities(
        &self,
        workspace_id: &str,
    ) -> AgenticSuperAppCodeOrchestrationResult<()> {
        self.workspaces
            .require(workspace_id, CodeWorkspaceCapability::ReadFiles)?;
        self.workspaces
            .require(workspace_id, CodeWorkspaceCapability::WriteFiles)?;
        self.workspaces
            .require(workspace_id, CodeWorkspaceCapability::ExecuteProcesses)?;
        self.workspaces
            .require(workspace_id, CodeWorkspaceCapability::ReadGit)?;
        Ok(())
    }

    async fn spawn_worker(&self, launch: WorkerLaunch) {
        let cancellation = CancellationToken::new();
        self.worker_controls.lock().await.insert(
            launch.dispatch.id.clone(),
            WorkerControl {
                run_id: launch.dispatch.run_id.clone(),
                cancellation: cancellation.clone(),
            },
        );
        let service = self.clone();
        tokio::spawn(async move {
            let result = service.run_codex_worker(&launch, cancellation).await;
            service
                .worker_controls
                .lock()
                .await
                .remove(&launch.dispatch.id);
            match result {
                Ok(result) => {
                    let _ = service.finish_worker(&launch, result).await;
                }
                Err(error) => {
                    let _ = service
                        .fail_dispatch(&launch.dispatch, &launch.task, &error.to_string())
                        .await;
                    let _ = service
                        .emit_status(
                            &launch.dispatch.run_id,
                            Some(&launch.task.id),
                            Some(&launch.dispatch.id),
                            &error.to_string(),
                            false,
                        )
                        .await;
                }
            }
        });
    }

    async fn cancel_worker(&self, dispatch_id: &str) {
        if let Some(control) = self.worker_controls.lock().await.get(dispatch_id) {
            control.cancellation.cancel();
        }
    }

    async fn cancel_workers_for_run(&self, run_id: &str) {
        let cancellations = self
            .worker_controls
            .lock()
            .await
            .values()
            .filter(|control| control.run_id == run_id)
            .map(|control| control.cancellation.clone())
            .collect::<Vec<_>>();
        for cancellation in cancellations {
            cancellation.cancel();
        }
    }

    async fn run_codex_worker(
        &self,
        launch: &WorkerLaunch,
        cancellation: CancellationToken,
    ) -> AgenticSuperAppCodeOrchestrationResult<WorkerResult> {
        let prompt = worker_prompt(&launch.task, launch.answer.as_deref());
        let mut command = self.worker_adapter.command(
            &launch.dispatch.adapter_id,
            Path::new(&launch.worktree.path),
            launch.model.as_deref(),
            launch.resume_session_id.as_deref(),
        );
        configure_worker_process(&mut command);
        configure_worker_environment(&mut command);
        command
            .arg("-")
            .env(
                "AGENTIC_SUPER_APP_DISPATCH_SECRET",
                hex_encode(&launch.secret),
            )
            .env("AGENTIC_SUPER_APP_DISPATCH_ID", &launch.dispatch.id)
            .env(
                "AGENTIC_SUPER_APP_DISPATCH_LEASE",
                launch.dispatch.lease_generation.to_string(),
            )
            .env("AGENTIC_SUPER_APP_DISPATCH_SEQUENCE", "0")
            .env(
                "AGENTIC_SUPER_APP_DISPATCH_BRIDGE",
                dispatch_bridge_program(),
            )
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let mut child = command.spawn().map_err(|error| {
            AgenticSuperAppCodeOrchestrationError::WorkerUnavailable(error.to_string())
        })?;
        let pid = child.id();
        let _ = self
            .persistence
            .update_orchestration_dispatch(
                &launch.dispatch.id,
                launch.dispatch.lease_generation,
                CodeDispatchState::Running,
                launch.dispatch.session_id.as_deref(),
                pid,
                Some(&launch.worktree.id),
                None,
                Some(now_ms()),
                None,
                None,
            )
            .await?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(prompt.as_bytes()).await?;
            stdin.shutdown().await?;
        }
        let stdout = child.stdout.take().ok_or_else(|| {
            AgenticSuperAppCodeOrchestrationError::WorkerFailed(
                "Codex worker did not expose stdout".to_owned(),
            )
        })?;
        let stderr = child.stderr.take().ok_or_else(|| {
            AgenticSuperAppCodeOrchestrationError::WorkerFailed(
                "Codex worker did not expose stderr".to_owned(),
            )
        })?;
        let (line_sender, mut line_receiver) = mpsc::channel(64);
        let stdout_reader = tokio::spawn(stream_worker_stdout(stdout, line_sender));
        let stderr_reader = tokio::spawn(read_bounded_worker_stderr(stderr));
        let heartbeat_service = self.clone();
        let heartbeat_dispatch_id = launch.dispatch.id.clone();
        let heartbeat_generation = launch.dispatch.lease_generation;
        let heartbeat_worktree_id = launch.worktree.id.clone();
        let heartbeat = tokio::spawn(async move {
            loop {
                sleep(Duration::from_secs(5)).await;
                let Ok(updated) = heartbeat_service
                    .persistence
                    .update_orchestration_dispatch(
                        &heartbeat_dispatch_id,
                        heartbeat_generation,
                        CodeDispatchState::Running,
                        None,
                        None,
                        Some(&heartbeat_worktree_id),
                        None,
                        Some(now_ms()),
                        None,
                        None,
                    )
                    .await
                else {
                    break;
                };
                if !updated {
                    break;
                }
            }
        });
        let mut stdout_text = String::new();
        let mut exit_status = None;
        let mut stream_error = None;
        let mut cancelled = false;
        loop {
            tokio::select! {
                line = line_receiver.recv() => {
                    match line {
                        Some(WorkerOutputLine::Text(line)) => {
                            if stdout_text.len().saturating_add(line.len()) > MAX_WORKER_OUTPUT_BYTES {
                                stream_error = Some("Codex worker stdout exceeded the supported size".to_owned());
                                force_terminate_worker_process(pid);
                                let _ = child.start_kill();
                                let _ = child.wait().await;
                                break;
                            }
                            stdout_text.push_str(&line);
                            if let Some(event_json) = line.strip_prefix("AGENTIC_SUPER_APP_EVENT ") {
                                if let Err(error) = self.accept_worker_event(launch, event_json.trim()).await {
                                    stream_error = Some(error.to_string());
                                    force_terminate_worker_process(pid);
                                    let _ = child.start_kill();
                                    let _ = child.wait().await;
                                    break;
                                }
                            }
                        }
                        Some(WorkerOutputLine::Error(error)) => {
                            stream_error = Some(error);
                            force_terminate_worker_process(pid);
                            let _ = child.start_kill();
                            let _ = child.wait().await;
                            break;
                        }
                        None => {
                            if exit_status.is_some() {
                                break;
                            }
                        }
                    }
                }
                status = child.wait(), if exit_status.is_none() => {
                    exit_status = Some(status?);
                    while let Some(line) = line_receiver.recv().await {
                        match line {
                            WorkerOutputLine::Text(line) => {
                                if stdout_text.len().saturating_add(line.len()) <= MAX_WORKER_OUTPUT_BYTES {
                                    stdout_text.push_str(&line);
                                    if let Some(event_json) = line.strip_prefix("AGENTIC_SUPER_APP_EVENT ") {
                                        if let Err(error) = self.accept_worker_event(launch, event_json.trim()).await {
                                            stream_error = Some(error.to_string());
                                            break;
                                        }
                                    }
                                }
                            }
                            WorkerOutputLine::Error(error) => stream_error = Some(error),
                        }
                    }
                    break;
                }
                _ = cancellation.cancelled() => {
                    cancelled = true;
                    request_worker_stop(pid);
                    if timeout(Duration::from_millis(WORKER_CANCEL_GRACE_MS), child.wait()).await.is_err() {
                        force_terminate_worker_process(pid);
                        let _ = child.start_kill();
                        let _ = child.wait().await;
                    }
                    break;
                }
            }
        }
        heartbeat.abort();
        if cancelled {
            let _ = stdout_reader.await;
            let _ = stderr_reader.await;
            return Ok(WorkerResult {
                success: false,
                session_id: None,
                summary: "Worker cancelled".to_owned(),
                question: None,
            });
        }
        let _ = stdout_reader.await;
        let stderr = stderr_reader.await.map_err(|error| {
            AgenticSuperAppCodeOrchestrationError::WorkerFailed(error.to_string())
        })??;
        if let Some(error) = stream_error {
            return Err(AgenticSuperAppCodeOrchestrationError::WorkerFailed(error));
        }
        let status = exit_status.ok_or_else(|| {
            AgenticSuperAppCodeOrchestrationError::WorkerFailed(
                "Codex worker exited without a status".to_owned(),
            )
        })?;
        let parsed = parse_worker_output(
            &limit_text(stdout_text.as_bytes(), MAX_WORKER_OUTPUT_BYTES),
            &limit_text(&stderr, 32 * 1024),
            status.success(),
        );
        Ok(parsed)
    }

    async fn accept_worker_event(
        &self,
        launch: &WorkerLaunch,
        event_json: &str,
    ) -> AgenticSuperAppCodeOrchestrationResult<()> {
        let event = Self::verify_worker_event(&launch.secret, event_json)?;
        if event.dispatch_id != launch.dispatch.id
            || event.lease_generation != launch.dispatch.lease_generation
            || !self.worker_lease_is_current(launch).await?
        {
            return Err(AgenticSuperAppCodeOrchestrationError::InvalidWorkerEvent);
        }
        let kind = parse_message_kind(&event.kind)
            .ok_or(AgenticSuperAppCodeOrchestrationError::InvalidWorkerEvent)?;
        let event_id = format!("event-{}", Uuid::now_v7());
        let persisted = self
            .persistence
            .insert_orchestration_event(
                &launch.dispatch.run_id,
                &event_id,
                Some(&launch.task.id),
                Some(&launch.dispatch.id),
                event.lease_generation,
                kind,
                &event.payload,
                true,
                CodeOrchestrationEventOrigin::Worker,
                Some(event.sequence),
                Some(&event.nonce),
            )
            .await?;
        if persisted.event_id == event_id {
            let _ = self.events.send(persisted);
        }
        Ok(())
    }

    async fn finish_worker(
        &self,
        launch: &WorkerLaunch,
        result: WorkerResult,
    ) -> AgenticSuperAppCodeOrchestrationResult<()> {
        if !self.worker_lease_is_current(launch).await? {
            return Ok(());
        }
        if let Some(question) = result.question {
            let dispatch_updated = self
                .persistence
                .update_orchestration_dispatch(
                    &launch.dispatch.id,
                    launch.dispatch.lease_generation,
                    CodeDispatchState::AwaitingInput,
                    result.session_id.as_deref(),
                    None,
                    Some(&launch.worktree.id),
                    None,
                    Some(now_ms()),
                    None,
                    Some(&result.summary),
                )
                .await?;
            if !dispatch_updated {
                return Ok(());
            }
            let question_row = agentic_super_app_protocol::CodeQuestion {
                id: format!("question-{}", Uuid::now_v7()),
                run_id: launch.dispatch.run_id.clone(),
                task_id: launch.task.id.clone(),
                dispatch_id: launch.dispatch.id.clone(),
                prompt: question.clone(),
                answer: None,
                answered: false,
                created_at_unix_ms: now_ms(),
            };
            self.persistence
                .insert_orchestration_question(&question_row)
                .await?;
            self.persistence
                .insert_orchestration_message(&CodeOrchestrationMessage {
                    id: format!("message-{}", Uuid::now_v7()),
                    run_id: launch.dispatch.run_id.clone(),
                    task_id: Some(launch.task.id.clone()),
                    dispatch_id: Some(launch.dispatch.id.clone()),
                    kind: CodeOrchestrationMessageKind::Question,
                    question_id: Some(question_row.id.clone()),
                    payload: question,
                    created_at_unix_ms: now_ms(),
                })
                .await?;
            self.persistence
                .set_orchestration_task_state(
                    &launch.dispatch.run_id,
                    &launch.task.id,
                    CodeTaskState::AwaitingInput,
                    Some(&launch.dispatch.id),
                    None,
                    None,
                    None,
                    None,
                )
                .await?;
            self.persistence
                .set_orchestration_run_state(
                    &launch.dispatch.run_id,
                    CodeRunState::Blocked,
                    Some("Worker is waiting for input"),
                )
                .await?;
            self.emit_status(
                &launch.dispatch.run_id,
                Some(&launch.task.id),
                Some(&launch.dispatch.id),
                "Worker is waiting for input",
                true,
            )
            .await?;
            return Ok(());
        }
        if !result.success {
            self.fail_dispatch(&launch.dispatch, &launch.task, &result.summary)
                .await?;
            self.emit_status(
                &launch.dispatch.run_id,
                Some(&launch.task.id),
                Some(&launch.dispatch.id),
                &result.summary,
                false,
            )
            .await?;
            return Ok(());
        }
        if !self.worker_lease_is_current(launch).await? {
            return Ok(());
        }
        let run_detail = self.detail(&launch.dispatch.run_id).await?;
        let root = self
            .workspaces
            .root_path(&run_detail.summary.workspace_id)?;
        let base_oid = run_detail
            .checkpoints
            .iter()
            .find(|checkpoint| {
                checkpoint.id
                    == launch
                        .task
                        .base_checkpoint_id
                        .as_deref()
                        .unwrap_or_default()
            })
            .and_then(|checkpoint| checkpoint.commit_oid.as_deref())
            .ok_or_else(|| {
                AgenticSuperAppCodeOrchestrationError::InvalidState(
                    "worker has no base checkpoint".to_owned(),
                )
            })?;
        let ref_name = format!(
            "agentic-super-app/result/{}/{}/{}",
            short_id(&launch.dispatch.run_id),
            short_id(&launch.task.id),
            launch.dispatch.attempt
        );
        let checkpoint = self.git.create_checkpoint(
            Path::new(&launch.worktree.path),
            &ref_name,
            Some(base_oid),
            &format!("orchestration result: {}", launch.task.title),
        )?;
        let persisted_checkpoint = CodeCheckpoint {
            id: format!("checkpoint-{}", Uuid::now_v7()),
            run_id: launch.dispatch.run_id.clone(),
            task_id: Some(launch.task.id.clone()),
            dispatch_id: Some(launch.dispatch.id.clone()),
            kind: CodeCheckpointKind::Result,
            state: CodeCheckpointState::Ready,
            ref_name: checkpoint.ref_name,
            commit_oid: Some(checkpoint.commit_oid),
            parent_checkpoint_id: launch.task.base_checkpoint_id.clone(),
            summary: result.summary.clone(),
            created_at_unix_ms: now_ms(),
        };
        if !self.worker_lease_is_current(launch).await? {
            let _ = self
                .git
                .unlock_worktree(&root, &worktree_name(&launch.worktree.path));
            return Ok(());
        }
        self.persistence
            .insert_orchestration_checkpoint(&persisted_checkpoint)
            .await?;
        let _ = self
            .git
            .unlock_worktree(&root, &worktree_name(&launch.worktree.path));
        let inspection = self
            .git
            .inspect_worktree(&root, &worktree_name(&launch.worktree.path))?;
        let _ = self
            .persistence
            .update_orchestration_worktree(
                &launch.worktree.id,
                CodeManagedWorktreeState::Ready,
                !inspection.dirty_files.is_empty(),
                inspection.locked,
                None,
            )
            .await?;
        let dispatch_updated = self
            .persistence
            .update_orchestration_dispatch(
                &launch.dispatch.id,
                launch.dispatch.lease_generation,
                CodeDispatchState::Succeeded,
                result.session_id.as_deref(),
                None,
                Some(&launch.worktree.id),
                Some(&persisted_checkpoint.id),
                Some(now_ms()),
                None,
                Some(&result.summary),
            )
            .await?;
        if !dispatch_updated {
            return Ok(());
        }
        let task_state = if self
            .detail(&launch.dispatch.run_id)
            .await?
            .summary
            .review_policy
            == CodeReviewPolicy::Manual
        {
            CodeTaskState::AwaitingReview
        } else {
            CodeTaskState::Completed
        };
        let task_updated = self
            .persistence
            .set_orchestration_task_result(
                &launch.dispatch.run_id,
                &launch.task.id,
                &launch.dispatch.id,
                launch.dispatch.lease_generation,
                task_state,
                Some(&persisted_checkpoint.id),
                None,
            )
            .await?;
        if !task_updated {
            return Ok(());
        }
        self.emit_status(
            &launch.dispatch.run_id,
            Some(&launch.task.id),
            Some(&launch.dispatch.id),
            if task_state == CodeTaskState::AwaitingReview {
                "Checkpoint ready for review"
            } else {
                "Worker completed"
            },
            true,
        )
        .await?;
        self.reconcile_run(&launch.dispatch.run_id).await?;
        Ok(())
    }

    async fn worker_lease_is_current(
        &self,
        launch: &WorkerLaunch,
    ) -> AgenticSuperAppCodeOrchestrationResult<bool> {
        let detail = self.detail(&launch.dispatch.run_id).await?;
        if detail.summary.state == CodeRunState::Cancelled {
            return Ok(false);
        }
        Ok(detail.tasks.iter().any(|task| {
            task.id == launch.task.id
                && task.active_dispatch_id.as_deref() == Some(launch.dispatch.id.as_str())
        }) && detail.dispatches.iter().any(|dispatch| {
            dispatch.id == launch.dispatch.id
                && dispatch.lease_generation == launch.dispatch.lease_generation
                && matches!(
                    dispatch.state,
                    CodeDispatchState::Preparing
                        | CodeDispatchState::Running
                        | CodeDispatchState::AwaitingInput
                        | CodeDispatchState::Checkpointing
                )
        }))
    }

    async fn reconcile_run(&self, run_id: &str) -> AgenticSuperAppCodeOrchestrationResult<()> {
        let detail = self.detail(run_id).await?;
        if matches!(
            detail.summary.state,
            CodeRunState::Cancelled | CodeRunState::Paused | CodeRunState::Interrupted
        ) {
            return Ok(());
        }
        if detail
            .tasks
            .iter()
            .any(|task| task.state == CodeTaskState::Failed)
        {
            self.persistence
                .set_orchestration_run_state(run_id, CodeRunState::Failed, Some("A task failed"))
                .await?;
            return Ok(());
        }
        if detail.tasks.iter().any(|task| {
            matches!(
                task.state,
                CodeTaskState::AwaitingInput | CodeTaskState::AwaitingReview
            )
        }) {
            self.persistence
                .set_orchestration_run_state(run_id, CodeRunState::Blocked, None)
                .await?;
            return Ok(());
        }
        if detail
            .tasks
            .iter()
            .all(|task| task.state == CodeTaskState::Completed)
        {
            self.persistence
                .set_orchestration_run_state(run_id, CodeRunState::Completed, None)
                .await?;
            return Ok(());
        }
        if detail.tasks.iter().any(|task| {
            matches!(
                task.state,
                CodeTaskState::Preparing
                    | CodeTaskState::Running
                    | CodeTaskState::Ready
                    | CodeTaskState::Draft
            )
        }) {
            return Ok(());
        }
        self.persistence
            .set_orchestration_run_state(
                run_id,
                CodeRunState::Blocked,
                Some("No task is currently runnable"),
            )
            .await?;
        Ok(())
    }

    async fn emit_status(
        &self,
        run_id: &str,
        task_id: Option<&str>,
        dispatch_id: Option<&str>,
        payload: &str,
        accepted: bool,
    ) -> AgenticSuperAppCodeOrchestrationResult<CodeOrchestrationEventEnvelope> {
        let _event_guard = self.event_lock.lock().await;
        let payload = truncate(payload, MAX_EVENT_PAYLOAD_BYTES);
        let event = self
            .persistence
            .insert_orchestration_event(
                run_id,
                &format!("event-{}", Uuid::now_v7()),
                task_id,
                dispatch_id,
                0,
                CodeOrchestrationMessageKind::Status,
                &payload,
                accepted,
                CodeOrchestrationEventOrigin::Host,
                None,
                None,
            )
            .await?;
        let _ = self.events.send(event.clone());
        let _ = self
            .persistence
            .insert_orchestration_message(&CodeOrchestrationMessage {
                id: format!("message-{}", Uuid::now_v7()),
                run_id: run_id.to_owned(),
                task_id: task_id.map(ToOwned::to_owned),
                dispatch_id: dispatch_id.map(ToOwned::to_owned),
                kind: CodeOrchestrationMessageKind::Status,
                question_id: None,
                payload,
                created_at_unix_ms: now_ms(),
            })
            .await;
        Ok(event)
    }
}

#[derive(Debug, Deserialize)]
struct BridgeEvent {
    dispatch_id: String,
    lease_generation: u64,
    sequence: u64,
    kind: String,
    payload: String,
    nonce: String,
    mac: String,
}

enum WorkerOutputLine {
    Text(String),
    Error(String),
}

async fn stream_worker_stdout(
    stdout: ChildStdout,
    sender: mpsc::Sender<WorkerOutputLine>,
) -> Result<(), std::io::Error> {
    let mut reader = BufReader::new(stdout);
    let mut line = String::new();
    let mut total = 0_usize;
    loop {
        line.clear();
        let bytes_read = reader.read_line(&mut line).await?;
        if bytes_read == 0 {
            break;
        }
        total = total.saturating_add(bytes_read);
        if total > MAX_WORKER_OUTPUT_BYTES {
            let _ = sender
                .send(WorkerOutputLine::Error(
                    "Codex worker stdout exceeded the supported size".to_owned(),
                ))
                .await;
            break;
        }
        if sender
            .send(WorkerOutputLine::Text(line.clone()))
            .await
            .is_err()
        {
            break;
        }
    }
    Ok(())
}

async fn read_bounded_worker_stderr(mut stderr: ChildStderr) -> Result<Vec<u8>, std::io::Error> {
    let mut output = Vec::new();
    let mut buffer = [0_u8; 8 * 1024];
    loop {
        let bytes_read = stderr.read(&mut buffer).await?;
        if bytes_read == 0 {
            break;
        }
        let remaining = (32_usize * 1024).saturating_sub(output.len());
        if remaining > 0 {
            output.extend_from_slice(&buffer[..bytes_read.min(remaining)]);
        }
    }
    Ok(output)
}

fn dispatch_bridge_program() -> String {
    let executable_name = if cfg!(windows) {
        "agentic-super-app-dispatch-bridge.exe"
    } else {
        "agentic-super-app-dispatch-bridge"
    };
    if let Ok(current_executable) = std::env::current_exe() {
        if let Some(parent) = current_executable.parent() {
            let mut candidates = vec![
                parent.join(executable_name),
                parent.join("binaries").join(executable_name),
            ];
            if let Some(grandparent) = parent.parent() {
                candidates.push(grandparent.join(executable_name));
                candidates.push(grandparent.join("binaries").join(executable_name));
            }
            if let Some(path) = candidates.into_iter().find(|path| path.is_file()) {
                return path.to_string_lossy().into_owned();
            }
        }
    }
    executable_name.to_owned()
}

fn configure_worker_process(command: &mut Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        unsafe {
            command.as_std_mut().pre_exec(|| {
                if libc::setpgid(0, 0) == -1 {
                    return Err(std::io::Error::last_os_error());
                }
                Ok(())
            });
        }
    }
    #[cfg(not(unix))]
    let _ = command;
}

fn configure_worker_environment(command: &mut Command) {
    let inherited = WORKER_ENVIRONMENT_ALLOWLIST
        .iter()
        .filter_map(|name| std::env::var_os(name).map(|value| (*name, value)))
        .collect::<Vec<_>>();
    command.env_clear();
    for (name, value) in inherited {
        command.env(name, value);
    }
}

fn request_worker_stop(pid: Option<u32>) {
    let Some(pid) = pid else { return };
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(unix)]
    unsafe {
        let _ = libc::kill(-(pid as i32), libc::SIGTERM);
        let _ = libc::kill(pid as i32, libc::SIGTERM);
    }
}

fn force_terminate_worker_process(pid: Option<u32>) {
    let Some(pid) = pid else { return };
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/T", "/F"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status();
    }
    #[cfg(unix)]
    unsafe {
        let _ = libc::kill(-(pid as i32), libc::SIGKILL);
        let _ = libc::kill(pid as i32, libc::SIGKILL);
    }
}

fn ensure_editable_run(state: &CodeRunState) -> AgenticSuperAppCodeOrchestrationResult<()> {
    if matches!(
        state,
        CodeRunState::Draft
            | CodeRunState::Ready
            | CodeRunState::Blocked
            | CodeRunState::Interrupted
            | CodeRunState::Paused
    ) {
        Ok(())
    } else {
        Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
            "the run is already executing or terminal".to_owned(),
        ))
    }
}

fn find_task<'a>(tasks: &'a [CodeTask], value: &str) -> Option<&'a CodeTask> {
    tasks
        .iter()
        .find(|task| task.id == value || task.client_id == value)
}

fn resolve_dependency_ids(
    tasks: &[CodeTask],
    requested: &[String],
    task_id: &str,
) -> AgenticSuperAppCodeOrchestrationResult<Vec<CodeTaskDependency>> {
    requested
        .iter()
        .map(|dependency| {
            let dependency_task = find_task(tasks, dependency)
                .ok_or_else(|| CodeDomainError::MissingTask(dependency.clone()))?;
            if dependency_task.id == task_id {
                return Err(CodeDomainError::SelfDependency.into());
            }
            Ok(CodeTaskDependency {
                run_id: dependency_task.run_id.clone(),
                task_id: task_id.to_owned(),
                depends_on_task_id: dependency_task.id.clone(),
            })
        })
        .collect()
}

fn validate_proposal(proposal: &CodeDagProposal) -> AgenticSuperAppCodeOrchestrationResult<()> {
    validate_orchestration_text(&proposal.objective)?;
    if proposal.tasks.is_empty() {
        return Err(AgenticSuperAppCodeOrchestrationError::InvalidState(
            "a proposal must contain at least one task".to_owned(),
        ));
    }
    let mut ids = Vec::with_capacity(proposal.tasks.len());
    let mut dependencies = Vec::new();
    for task in &proposal.tasks {
        validate_orchestration_text(&task.client_id)?;
        validate_orchestration_text(&task.title)?;
        validate_orchestration_text(&task.specification)?;
        ids.push(task.client_id.clone());
        dependencies.extend(task.depends_on.iter().map(|dependency| CodeTaskDependency {
            run_id: String::new(),
            task_id: task.client_id.clone(),
            depends_on_task_id: dependency.clone(),
        }));
    }
    validate_orchestration_dag(&ids, &dependencies)?;
    Ok(())
}

fn fallback_proposal(objective: &str) -> CodeDagProposal {
    CodeDagProposal {
        objective: objective.trim().to_owned(),
        tasks: vec![CodeDagProposalTask {
            client_id: "implementation".to_owned(),
            title: "Implement the requested objective".to_owned(),
            specification: objective.trim().to_owned(),
            depends_on: Vec::new(),
        }],
        warnings: vec![
            "Codex did not return a structured proposal; review and split this task before accepting it."
                .to_owned(),
        ],
    }
}

fn parse_proposal_output(output: &str) -> Option<CodeDagProposal> {
    if output.len() > MAX_PROPOSAL_BYTES {
        return None;
    }
    for line in output.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            if let Some(proposal) = find_proposal(&value) {
                return Some(proposal);
            }
        } else if let Ok(value) = serde_json::from_str::<Value>(line.trim_matches('`')) {
            if let Some(proposal) = find_proposal(&value) {
                return Some(proposal);
            }
        }
    }
    None
}

fn find_proposal(value: &Value) -> Option<CodeDagProposal> {
    if let Ok(proposal) = serde_json::from_value::<CodeDagProposal>(value.clone()) {
        return Some(proposal);
    }
    match value {
        Value::Object(object) => object.values().find_map(find_proposal),
        Value::Array(values) => values.iter().find_map(find_proposal),
        Value::String(text) => serde_json::from_str::<Value>(text)
            .ok()
            .and_then(|value| find_proposal(&value)),
        Value::Null | Value::Bool(_) | Value::Number(_) => None,
    }
}

fn parse_worker_output(stdout: &str, stderr: &str, process_success: bool) -> WorkerResult {
    let mut session_id = None;
    let mut summary = None;
    let mut question = None;
    for line in stdout.lines() {
        let line = line.trim();
        if let Some(question_text) = line.strip_prefix("AGENTIC_SUPER_APP_QUESTION:") {
            if !question_text.trim().is_empty() {
                question = Some(question_text.trim().to_owned());
            }
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("type").and_then(Value::as_str) == Some("thread.started") {
            session_id = value
                .get("thread_id")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
        }
        if value.get("type").and_then(Value::as_str) == Some("error") {
            summary = value
                .get("message")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned);
        }
        if value.get("type").and_then(Value::as_str) == Some("item.completed") {
            if let Some(text) = value
                .get("item")
                .and_then(|item| item.get("text").or_else(|| item.get("content")))
                .and_then(value_as_text)
            {
                summary = Some(text);
            }
        }
    }
    let fallback = if !stderr.trim().is_empty() {
        stderr.trim().to_owned()
    } else if stdout.trim().is_empty() {
        "Codex worker returned no output".to_owned()
    } else {
        "Worker completed the task".to_owned()
    };
    let summary = truncate(summary.as_deref().unwrap_or(&fallback), 16 * 1024);
    WorkerResult {
        success: process_success && question.is_none() && !summary.starts_with("Error:"),
        session_id,
        summary,
        question,
    }
}

fn value_as_text(value: &Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_owned());
    }
    if let Some(values) = value.as_array() {
        let text = values
            .iter()
            .filter_map(|value| value.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n");
        if !text.is_empty() {
            return Some(text);
        }
    }
    None
}

fn worker_prompt(task: &CodeTask, answer: Option<&str>) -> String {
    let answer = answer
        .map(|answer| format!("\nThe user answered your previous question:\n{answer}\n"))
        .unwrap_or_default();
    format!(
        "You are a bounded implementation worker inside an Agentic Super App run. Work only in the provided Git worktree. Do not modify the parent workspace, change remotes, or create pull requests. Inspect the repository, implement the task, and validate it with focused tests when practical. If a decision is required, stop and print exactly `AGENTIC_SUPER_APP_QUESTION: <question>` rather than guessing. For progress or escalation messages, you may invoke the executable in `$AGENTIC_SUPER_APP_DISPATCH_BRIDGE` with `<kind> <payload> <sequence>`; never print or expose the dispatch secret, and continue if the bridge is unavailable.\n\nTask: {}\n\nSpecification:\n{}\n{}\nAt the end, report a concise summary of changes and validation.",
        task.title, task.specification, answer
    )
}

fn hex_decode(value: &str) -> AgenticSuperAppCodeOrchestrationResult<Vec<u8>> {
    if !value.len().is_multiple_of(2) || value.len() > 128 {
        return Err(AgenticSuperAppCodeOrchestrationError::InvalidWorkerEvent);
    }
    let bytes = value.as_bytes();
    let mut result = Vec::with_capacity(bytes.len() / 2);
    for chunk in bytes.chunks_exact(2) {
        let high =
            hex_value(chunk[0]).ok_or(AgenticSuperAppCodeOrchestrationError::InvalidWorkerEvent)?;
        let low =
            hex_value(chunk[1]).ok_or(AgenticSuperAppCodeOrchestrationError::InvalidWorkerEvent)?;
        result.push((high << 4) | low);
    }
    Ok(result)
}

fn hex_encode(value: &[u8]) -> String {
    value.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn dispatch_secret(_dispatch_id: &str, _lease_generation: u64) -> Vec<u8> {
    let mut secret = Vec::with_capacity(32);
    secret.extend_from_slice(Uuid::now_v7().as_bytes());
    secret.extend_from_slice(Uuid::now_v7().as_bytes());
    secret
}

fn parse_message_kind(value: &str) -> Option<CodeOrchestrationMessageKind> {
    match value {
        "status" => Some(CodeOrchestrationMessageKind::Status),
        "heartbeat" => Some(CodeOrchestrationMessageKind::Heartbeat),
        "question" => Some(CodeOrchestrationMessageKind::Question),
        "answer" => Some(CodeOrchestrationMessageKind::Answer),
        "escalation" => Some(CodeOrchestrationMessageKind::Escalation),
        "progress" => Some(CodeOrchestrationMessageKind::Progress),
        "completion" => Some(CodeOrchestrationMessageKind::Completion),
        _ => None,
    }
}

fn hex_value(value: u8) -> Option<u8> {
    match value {
        b'0'..=b'9' => Some(value - b'0'),
        b'a'..=b'f' => Some(value - b'a' + 10),
        b'A'..=b'F' => Some(value - b'A' + 10),
        _ => None,
    }
}

fn available_memory_bytes() -> Option<u64> {
    #[cfg(target_os = "linux")]
    {
        let text = fs::read_to_string("/proc/meminfo").ok()?;
        let kib = text
            .lines()
            .find(|line| line.starts_with("MemAvailable:"))?
            .split_whitespace()
            .nth(1)?
            .parse::<u64>()?;
        return Some(kib.saturating_mul(1024));
    }
    #[cfg(target_os = "windows")]
    {
        #[repr(C)]
        struct MemoryStatus {
            length: u32,
            memory_load: u32,
            total_phys: u64,
            avail_phys: u64,
            total_page: u64,
            avail_page: u64,
            total_virtual: u64,
            avail_virtual: u64,
            avail_extended: u64,
        }
        extern "system" {
            fn GlobalMemoryStatusEx(status: *mut MemoryStatus) -> i32;
        }
        let mut status = MemoryStatus {
            length: std::mem::size_of::<MemoryStatus>() as u32,
            memory_load: 0,
            total_phys: 0,
            avail_phys: 0,
            total_page: 0,
            avail_page: 0,
            total_virtual: 0,
            avail_virtual: 0,
            avail_extended: 0,
        };
        unsafe {
            if GlobalMemoryStatusEx(&mut status) != 0 {
                return Some(status.avail_phys);
            }
        }
    }
    None
}

fn worktree_name(path: &str) -> String {
    Path::new(path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default()
        .to_owned()
}

fn short_id(value: &str) -> String {
    value
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .take(16)
        .collect()
}

fn short_hash(value: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = hasher.finalize();
    digest
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

fn truncate(value: &str, limit: usize) -> String {
    if value.len() <= limit {
        return value.to_owned();
    }
    let mut end = limit.saturating_sub("…".len());
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}…", &value[..end])
}

fn limit_text(bytes: &[u8], limit: usize) -> String {
    truncate(&String::from_utf8_lossy(bytes), limit)
}

#[cfg(test)]
mod tests {
    use super::*;
    use agentic_super_app_protocol::{
        CodeDagProposalAcceptRequest, CodeDispatch, CodeOrchestrationEventOrigin,
        CodeOrchestrationMessageKind, CodeReviewPolicy, CodeRunCreateRequest,
    };

    #[test]
    fn bridge_event_signature_round_trips() {
        let secret = b"test-secret";
        let dispatch_id = "dispatch-1";
        let lease_generation = 4;
        let sequence = 2;
        let kind = "progress";
        let payload = "working";
        let nonce = "nonce";
        let canonical =
            format!("{dispatch_id}\n{lease_generation}\n{sequence}\n{kind}\n{payload}\n{nonce}");
        let mut mac = HmacSha256::new_from_slice(secret).unwrap();
        mac.update(canonical.as_bytes());
        let mac = mac
            .finalize()
            .into_bytes()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        let json = serde_json::json!({
            "dispatch_id": dispatch_id,
            "lease_generation": lease_generation,
            "sequence": sequence,
            "kind": kind,
            "payload": payload,
            "nonce": nonce,
            "mac": mac,
        });
        let event =
            AgenticSuperAppCodeOrchestration::verify_worker_event(secret, &json.to_string())
                .unwrap();
        assert_eq!(event.dispatch_id, dispatch_id);
        assert!(
            AgenticSuperAppCodeOrchestration::verify_worker_event(b"wrong", &json.to_string())
                .is_err()
        );
    }

    #[test]
    fn worker_output_extracts_session_and_summary() {
        let result = parse_worker_output(
            r#"{"type":"thread.started","thread_id":"session-1"}
               {"type":"item.completed","item":{"text":"done"}}"#,
            "",
            true,
        );
        assert_eq!(result.session_id.as_deref(), Some("session-1"));
        assert_eq!(result.summary, "done");
        assert!(result.success);
    }

    #[tokio::test]
    async fn persists_a_reviewable_run_and_accepted_dag() {
        let directory = tempfile::tempdir().unwrap();
        let workspace_root = directory.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let persistence = AgenticSuperAppPersistence::open(&directory.path().join("state.sqlite"))
            .await
            .unwrap();
        let workspaces = AgenticSuperAppWorkspaceService::new();
        let workspace = workspaces
            .open_workspace(
                &workspace_root,
                None,
                agentic_super_app_protocol::CodeWorkspaceTrust::Trusted,
            )
            .unwrap();
        persistence.save_code_workspace(&workspace).await.unwrap();
        let service = AgenticSuperAppCodeOrchestration::new(
            persistence,
            workspaces,
            directory.path().join("orchestration"),
        );
        let run = service
            .create_run(&CodeRunCreateRequest {
                workspace_id: workspace.id,
                title: "Test run".to_owned(),
                objective: "Validate durable task planning".to_owned(),
                review_policy: CodeReviewPolicy::Manual,
                concurrency_limit: Some(2),
                model: None,
                coordinator_id: None,
                adapter_id: None,
            })
            .await
            .unwrap();
        assert_eq!(run.summary.state, CodeRunState::Draft);
        assert_eq!(run.events.len(), 1);
        let accepted = service
            .accept_proposal(&CodeDagProposalAcceptRequest {
                run_id: run.summary.id,
                proposal: CodeDagProposal {
                    objective: "Validate durable task planning".to_owned(),
                    tasks: vec![
                        CodeDagProposalTask {
                            client_id: "plan".to_owned(),
                            title: "Plan".to_owned(),
                            specification: "Write the plan".to_owned(),
                            depends_on: Vec::new(),
                        },
                        CodeDagProposalTask {
                            client_id: "verify".to_owned(),
                            title: "Verify".to_owned(),
                            specification: "Verify the plan".to_owned(),
                            depends_on: vec!["plan".to_owned()],
                        },
                    ],
                    warnings: Vec::new(),
                },
            })
            .await
            .unwrap();
        assert_eq!(accepted.summary.state, CodeRunState::Ready);
        assert_eq!(accepted.tasks.len(), 2);
        assert_eq!(accepted.dependencies.len(), 1);
    }

    #[tokio::test]
    async fn denies_worker_planning_for_an_untrusted_workspace() {
        let directory = tempfile::tempdir().unwrap();
        let workspace_root = directory.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let persistence = AgenticSuperAppPersistence::open(&directory.path().join("state.sqlite"))
            .await
            .unwrap();
        let workspaces = AgenticSuperAppWorkspaceService::new();
        let workspace = workspaces
            .open_workspace(
                &workspace_root,
                None,
                agentic_super_app_protocol::CodeWorkspaceTrust::Untrusted,
            )
            .unwrap();
        let service = AgenticSuperAppCodeOrchestration::new(
            persistence,
            workspaces,
            directory.path().join("orchestration"),
        );
        let result = service
            .propose_dag(&CodeDagProposalRequest {
                workspace_id: workspace.id,
                objective: "Inspect the repository safely".to_owned(),
                model: None,
            })
            .await;
        assert!(matches!(
            result,
            Err(AgenticSuperAppCodeOrchestrationError::Workspace(
                AgenticSuperAppWorkspaceError::CapabilityDenied(
                    CodeWorkspaceCapability::ExecuteProcesses
                )
            ))
        ));
    }

    #[tokio::test]
    async fn worker_failure_closes_the_dispatch_and_task_lease() {
        let directory = tempfile::tempdir().unwrap();
        let workspace_root = directory.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let persistence = AgenticSuperAppPersistence::open(&directory.path().join("state.sqlite"))
            .await
            .unwrap();
        let workspaces = AgenticSuperAppWorkspaceService::new();
        let workspace = workspaces
            .open_workspace(
                &workspace_root,
                None,
                agentic_super_app_protocol::CodeWorkspaceTrust::Trusted,
            )
            .unwrap();
        persistence.save_code_workspace(&workspace).await.unwrap();
        let service = AgenticSuperAppCodeOrchestration::new(
            persistence.clone(),
            workspaces,
            directory.path().join("orchestration"),
        );
        let run = service
            .create_run(&CodeRunCreateRequest {
                workspace_id: workspace.id,
                title: "Failure test".to_owned(),
                objective: "Close failed worker leases".to_owned(),
                review_policy: CodeReviewPolicy::Manual,
                concurrency_limit: Some(1),
                model: None,
                coordinator_id: None,
                adapter_id: None,
            })
            .await
            .unwrap();
        let run = service
            .accept_proposal(&CodeDagProposalAcceptRequest {
                run_id: run.summary.id,
                proposal: CodeDagProposal {
                    objective: "Close failed worker leases".to_owned(),
                    tasks: vec![CodeDagProposalTask {
                        client_id: "worker".to_owned(),
                        title: "Worker".to_owned(),
                        specification: "Run the worker".to_owned(),
                        depends_on: Vec::new(),
                    }],
                    warnings: Vec::new(),
                },
            })
            .await
            .unwrap();
        let task = run.tasks[0].clone();
        let dispatch = CodeDispatch {
            id: "dispatch-failure".to_owned(),
            run_id: run.summary.id.clone(),
            task_id: task.id.clone(),
            attempt: 1,
            state: CodeDispatchState::Preparing,
            adapter_id: CODE_ORCHESTRATION_DEFAULT_ADAPTER_ID.to_owned(),
            lease_generation: 1,
            session_id: None,
            pid: None,
            worktree_id: None,
            checkpoint_id: None,
            last_heartbeat_at_unix_ms: Some(now_ms()),
            terminal_id: None,
            cancel_requested_at_unix_ms: None,
            started_at_unix_ms: now_ms(),
            updated_at_unix_ms: now_ms(),
            error: None,
            result_summary: None,
        };
        assert!(persistence
            .claim_orchestration_dispatch(&dispatch)
            .await
            .unwrap());
        service
            .fail_dispatch(&dispatch, &task, "worker unavailable")
            .await
            .unwrap();
        let detail = service.detail(&run.summary.id).await.unwrap();
        assert_eq!(detail.summary.state, CodeRunState::Failed);
        assert_eq!(detail.tasks[0].state, CodeTaskState::Failed);
        assert_eq!(detail.dispatches[0].state, CodeDispatchState::Failed);
    }

    #[tokio::test]
    async fn event_cursor_is_atomic_and_worker_nonce_replays_are_idempotent() {
        let directory = tempfile::tempdir().unwrap();
        let workspace_root = directory.path().join("workspace");
        std::fs::create_dir_all(&workspace_root).unwrap();
        let persistence = AgenticSuperAppPersistence::open(&directory.path().join("state.sqlite"))
            .await
            .unwrap();
        let workspaces = AgenticSuperAppWorkspaceService::new();
        let workspace = workspaces
            .open_workspace(
                &workspace_root,
                None,
                agentic_super_app_protocol::CodeWorkspaceTrust::Trusted,
            )
            .unwrap();
        persistence.save_code_workspace(&workspace).await.unwrap();
        let service = AgenticSuperAppCodeOrchestration::new(
            persistence.clone(),
            workspaces,
            directory.path().join("orchestration"),
        );
        let run = service
            .create_run(&CodeRunCreateRequest {
                workspace_id: workspace.id,
                title: "Event test".to_owned(),
                objective: "Validate event ordering".to_owned(),
                review_policy: CodeReviewPolicy::Manual,
                concurrency_limit: Some(1),
                model: None,
                coordinator_id: None,
                adapter_id: None,
            })
            .await
            .unwrap();
        let run_id = run.summary.id;
        let (left, right) = tokio::join!(
            persistence.insert_orchestration_event(
                &run_id,
                "event-concurrent-a",
                None,
                None,
                0,
                CodeOrchestrationMessageKind::Status,
                "a",
                true,
                CodeOrchestrationEventOrigin::Host,
                None,
                None,
            ),
            persistence.insert_orchestration_event(
                &run_id,
                "event-concurrent-b",
                None,
                None,
                0,
                CodeOrchestrationMessageKind::Status,
                "b",
                true,
                CodeOrchestrationEventOrigin::Host,
                None,
                None,
            )
        );
        let left = left.unwrap();
        let right = right.unwrap();
        assert_ne!(left.sequence, right.sequence);
        assert_eq!(right.sequence.abs_diff(left.sequence), 1);

        let first = persistence
            .insert_orchestration_event(
                &run_id,
                "event-worker-first",
                Some("task-1"),
                Some("dispatch-1"),
                1,
                CodeOrchestrationMessageKind::Progress,
                "working",
                true,
                CodeOrchestrationEventOrigin::Worker,
                Some(7),
                Some("nonce-1"),
            )
            .await
            .unwrap();
        let replay = persistence
            .insert_orchestration_event(
                &run_id,
                "event-worker-replay",
                Some("task-1"),
                Some("dispatch-1"),
                1,
                CodeOrchestrationMessageKind::Progress,
                "working again",
                true,
                CodeOrchestrationEventOrigin::Worker,
                Some(7),
                Some("nonce-1"),
            )
            .await
            .unwrap();
        assert_eq!(replay.event_id, first.event_id);
        assert_eq!(replay.sequence, first.sequence);
        assert_eq!(first.origin, CodeOrchestrationEventOrigin::Worker);
        assert_eq!(first.worker_sequence, Some(7));
    }
}
