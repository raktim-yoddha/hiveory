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
    CodeDispatchState, CodeManagedWorktree, CodeManagedWorktreeState,
    CodeOrchestrationEventEnvelope, CodeOrchestrationMessage, CodeOrchestrationMessageKind,
    CodeQuestionAnswerRequest, CodeReview, CodeReviewDecision, CodeReviewPolicy, CodeReviewRequest,
    CodeRunCreateRequest, CodeRunRequest, CodeRunState, CodeRunSummary, CodeTask,
    CodeTaskCreateRequest, CodeTaskDependency, CodeTaskRetryRequest, CodeTaskState,
    CodeTaskUpdateRequest,
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
    io::AsyncWriteExt,
    process::Command,
    sync::{broadcast, Mutex},
    time::{sleep, Duration},
};
use uuid::Uuid;

type HmacSha256 = Hmac<Sha256>;

const MAX_PROPOSAL_BYTES: usize = 128 * 1024;
const MAX_WORKER_OUTPUT_BYTES: usize = 256 * 1024;
const MAX_EVENT_PAYLOAD_BYTES: usize = 64 * 1024;
const EVENT_CHANNEL_CAPACITY: usize = 512;
const WORKER_POLL_INTERVAL_MS: u64 = 250;
const DEFAULT_CONCURRENCY: u8 = 2;

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
                        task.active_dispatch_id.as_deref().unwrap_or_default(),
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
                        task.active_dispatch_id.as_deref().unwrap_or_default(),
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
        } else if let Some(path) = inspection.dirty_files.first() {
            Some(format!("Uncommitted file: {path}"))
        } else {
            None
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
        if event.dispatch_id.len() > 128
            || event.kind.len() > 64
            || event.payload.len() > MAX_EVENT_PAYLOAD_BYTES
            || event.nonce.len() > 128
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
        loop {
            match self.schedule_once(&run_id).await {
                Ok(true) => sleep(Duration::from_millis(WORKER_POLL_INTERVAL_MS)).await,
                Ok(false) | Err(_) => break,
            }
        }
    }

    async fn schedule_once(&self, run_id: &str) -> AgenticSuperAppCodeOrchestrationResult<bool> {
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
            lease_generation: 1,
            session_id: None,
            pid: None,
            worktree_id: None,
            checkpoint_id: None,
            last_heartbeat_at_unix_ms: Some(now_ms()),
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
        self.persistence
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
        self.persistence
            .set_orchestration_task_result(
                &dispatch.run_id,
                &task.id,
                &dispatch.id,
                CodeTaskState::Failed,
                None,
                Some(error),
            )
            .await?;
        self.persistence
            .set_orchestration_run_state(&dispatch.run_id, CodeRunState::Failed, Some(error))
            .await?;
        Ok(())
    }

    async fn block_dispatch(
        &self,
        dispatch: &CodeDispatch,
        task: &CodeTask,
        error: &str,
    ) -> AgenticSuperAppCodeOrchestrationResult<()> {
        self.persistence
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
        let service = self.clone();
        tokio::spawn(async move {
            let result = service.run_codex_worker(&launch).await;
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

    async fn run_codex_worker(
        &self,
        launch: &WorkerLaunch,
    ) -> AgenticSuperAppCodeOrchestrationResult<WorkerResult> {
        let prompt = worker_prompt(&launch.task, launch.answer.as_deref());
        let mut command = Command::new("codex");
        command.arg("exec");
        if let Some(session_id) = launch.resume_session_id.as_deref() {
            command.arg("resume").arg(session_id);
        }
        command.arg("--json").arg("--cd").arg(&launch.worktree.path);
        if launch.resume_session_id.is_none() {
            command.arg("--sandbox").arg("workspace-write");
        }
        if let Some(model) = launch
            .model
            .as_deref()
            .filter(|value| !value.trim().is_empty())
        {
            command.arg("--model").arg(model);
        }
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
                "agentic-super-app-dispatch-bridge",
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
        let output = child.wait_with_output().await?;
        heartbeat.abort();
        let stdout = limit_text(&output.stdout, MAX_WORKER_OUTPUT_BYTES);
        let stderr = limit_text(&output.stderr, 32 * 1024);
        for line in stdout.lines() {
            if let Some(event_json) = line.strip_prefix("AGENTIC_SUPER_APP_EVENT ") {
                self.accept_worker_event(launch, event_json).await?;
            }
        }
        let parsed = parse_worker_output(&stdout, &stderr, output.status.success());
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
        let persisted = self
            .persistence
            .insert_orchestration_event(
                &launch.dispatch.run_id,
                &format!("event-{}", Uuid::now_v7()),
                Some(&launch.task.id),
                Some(&launch.dispatch.id),
                event.lease_generation,
                kind,
                &event.payload,
                true,
            )
            .await?;
        let _ = self.events.send(persisted);
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
        self.persistence
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
        self.persistence
            .set_orchestration_task_result(
                &launch.dispatch.run_id,
                &launch.task.id,
                &launch.dispatch.id,
                task_state,
                Some(&persisted_checkpoint.id),
                None,
            )
            .await?;
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
        "You are a bounded implementation worker inside an Agentic Super App run. Work only in the provided Git worktree. Do not modify the parent workspace, change remotes, or create pull requests. Inspect the repository, implement the task, and validate it with focused tests when practical. If a decision is required, stop and print exactly `AGENTIC_SUPER_APP_QUESTION: <question>` rather than guessing.\n\nTask: {}\n\nSpecification:\n{}\n{}\nAt the end, report a concise summary of changes and validation.",
        task.title, task.specification, answer
    )
}

fn hex_decode(value: &str) -> AgenticSuperAppCodeOrchestrationResult<Vec<u8>> {
    if value.len() % 2 != 0 || value.len() > 128 {
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

fn dispatch_secret(dispatch_id: &str, lease_generation: u64) -> Vec<u8> {
    let mut hasher = Sha256::new();
    hasher.update(Uuid::now_v7().as_bytes());
    hasher.update(dispatch_id.as_bytes());
    hasher.update(lease_generation.to_le_bytes());
    hasher.finalize().to_vec()
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
        CodeDagProposalAcceptRequest, CodeReviewPolicy, CodeRunCreateRequest,
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
}
