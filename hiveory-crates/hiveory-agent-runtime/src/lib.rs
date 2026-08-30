//! Local-first Agent execution runtime.
//!
//! The runtime owns the model/tool turn loop. Every externally visible
//! transition is written through the Agent store before it is broadcast to a
//! renderer, so a renderer or host restart cannot turn a tool call into an
//! untracked side effect.

use hiveory_agent_domain::{
    approval_is_allowed, builtin_skill_sources, memory_class_from_value,
    memory_is_eligible_for_explicit_storage, parse_skill_markdown, tool_requires_approval,
};
use hiveory_artifact_store::HiveoryArtifactStore;
use hiveory_model_gateway::{HiveoryModelProvider, HiveoryProviderError};
use hiveory_persistence::agent::{HiveoryAgentStore, HiveoryAgentStoreError};
use hiveory_persistence::routine::HiveoryRoutineStore;
use hiveory_protocol::{
    AgentApprovalDecision, AgentApprovalDecisionRequest, AgentApprovalPolicy, AgentArtifactKind,
    AgentArtifactSummary, AgentConversationCreateRequest, AgentConversationDetail,
    AgentConversationQuery, AgentCreateRequest, AgentDashboard, AgentDetail, AgentEventEnvelope,
    AgentEventKind, AgentEventsQuery, AgentExportRequest, AgentFolderGrant,
    AgentFolderGrantDeleteRequest, AgentFolderGrantRequest, AgentInputRequest,
    AgentMemoryDeleteRequest, AgentMemoryMutationRequest, AgentMemoryQuery, AgentMemorySummary,
    AgentModelTurnRequest, AgentProviderStreamEvent, AgentProviderStreamEventKind,
    AgentRunControlRequest, AgentRunDetail, AgentRunStartRequest, AgentRunState, AgentRunSummary,
    AgentSkillCatalog, AgentSkillConflictResolutionRequest, AgentSkillToggleRequest,
    AgentToolCallState, AgentToolDefinition, AgentToolRisk, AgentUpdateRequest,
};
use hiveory_tool_runtime::{
    hiveory_approval_fingerprint, HiveoryAuditLog, HiveoryExternalToolProvider,
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use tokio::sync::{broadcast, mpsc};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

const MAX_TEXT_READ_BYTES: u64 = 512 * 1024;
const MAX_TEXT_WRITE_BYTES: usize = 2 * 1024 * 1024;
const MAX_DIRECTORY_ENTRIES: usize = 200;

#[derive(Debug, Error)]
pub enum HiveoryAgentRuntimeError {
    #[error("agent store failure: {0}")]
    Store(#[from] HiveoryAgentStoreError),
    #[error("agent provider failure: {0}")]
    Provider(String),
    #[error("agent artifact failure: {0}")]
    Artifact(String),
    #[error("agent request is invalid: {0}")]
    InvalidInput(String),
    #[error("agent run was cancelled")]
    Cancelled,
}

#[derive(Debug, Clone)]
struct PendingFunctionCall {
    call_id: String,
    name: String,
    arguments_json: String,
    item_json: String,
}

#[derive(Debug)]
enum ToolExecution {
    Result(String),
    RequestInput(String),
}

#[derive(Clone)]
pub struct HiveoryAgentRuntime {
    store: HiveoryAgentStore,
    provider: Arc<dyn HiveoryModelProvider>,
    artifacts: HiveoryArtifactStore,
    audit: HiveoryAuditLog,
    skill_root: PathBuf,
    cancellations: Arc<Mutex<HashMap<String, CancellationToken>>>,
    events: broadcast::Sender<AgentEventEnvelope>,
    external_tools: Arc<Mutex<Option<Arc<dyn HiveoryExternalToolProvider>>>>,
}

impl HiveoryAgentRuntime {
    pub fn new(
        store: HiveoryAgentStore,
        provider: Arc<dyn HiveoryModelProvider>,
        artifacts: HiveoryArtifactStore,
        audit: HiveoryAuditLog,
        skill_root: PathBuf,
    ) -> Self {
        let (events, _) = broadcast::channel(512);
        Self {
            store,
            provider,
            artifacts,
            audit,
            skill_root,
            cancellations: Arc::new(Mutex::new(HashMap::new())),
            events,
            external_tools: Arc::new(Mutex::new(None)),
        }
    }

    pub fn set_external_tool_provider(&self, provider: Arc<dyn HiveoryExternalToolProvider>) {
        *self
            .external_tools
            .lock()
            .expect("agent external tool provider lock") = Some(provider);
    }

    pub fn store(&self) -> &HiveoryAgentStore {
        &self.store
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AgentEventEnvelope> {
        self.events.subscribe()
    }

    /// Install first-party skills and discover user-managed `SKILL.md` files.
    pub async fn initialize(&self) -> Result<(), HiveoryAgentRuntimeError> {
        for (id, source) in builtin_skill_sources() {
            let package = parse_skill_markdown(
                &format!("builtin/{id}/SKILL.md"),
                source,
                hiveory_protocol::AgentSkillOrigin::Builtin,
            )
            .map_err(|error| HiveoryAgentRuntimeError::InvalidInput(error.to_string()))?;
            self.store.upsert_skill(&package).await?;
        }
        fs::create_dir_all(&self.skill_root)
            .map_err(|error| HiveoryAgentRuntimeError::InvalidInput(error.to_string()))?;
        let entries = fs::read_dir(&self.skill_root)
            .map_err(|error| HiveoryAgentRuntimeError::InvalidInput(error.to_string()))?;
        for entry in entries.flatten().take(100) {
            let path = entry.path().join("SKILL.md");
            if !path.is_file() {
                continue;
            }
            let Ok(source) = fs::read_to_string(&path) else {
                continue;
            };
            if let Ok(package) = parse_skill_markdown(
                &path.to_string_lossy(),
                &source,
                hiveory_protocol::AgentSkillOrigin::ApplicationData,
            ) {
                self.store.upsert_skill(&package).await?;
            }
        }
        Ok(())
    }

    pub async fn recover(&self) -> Result<usize, HiveoryAgentRuntimeError> {
        Ok(self.store.interrupt_active_runs().await?)
    }

    pub async fn dashboard(&self) -> Result<AgentDashboard, HiveoryAgentRuntimeError> {
        Ok(self.store.dashboard().await?)
    }

    pub async fn list_agents(
        &self,
    ) -> Result<Vec<hiveory_protocol::AgentSummary>, HiveoryAgentRuntimeError> {
        Ok(self.store.list().await?)
    }

    pub async fn agent_detail(
        &self,
        agent_id: &str,
    ) -> Result<AgentDetail, HiveoryAgentRuntimeError> {
        let mut detail = self.store.detail(agent_id).await?;
        let enabled = self.store.enabled_tools(agent_id).await?;
        detail.tools = builtin_tool_definitions()
            .into_iter()
            .filter(|tool| enabled.is_empty() || enabled.iter().any(|name| name == &tool.name))
            .collect();
        let external_provider = self
            .external_tools
            .lock()
            .expect("agent external tool provider lock")
            .clone();
        if let Some(provider) = external_provider {
            detail.tools.extend(
                provider
                    .definitions(agent_id)
                    .await
                    .map_err(HiveoryAgentRuntimeError::InvalidInput)?,
            );
        }
        Ok(detail)
    }

    pub async fn create_agent(
        &self,
        request: &AgentCreateRequest,
    ) -> Result<AgentDetail, HiveoryAgentRuntimeError> {
        let detail = self.store.create(request).await?;
        for tool in builtin_tool_definitions() {
            self.store
                .enable_tool(&detail.summary.id, &tool.name, true)
                .await?;
        }
        self.agent_detail(&detail.summary.id).await
    }

    pub async fn update_agent(
        &self,
        request: &AgentUpdateRequest,
    ) -> Result<AgentDetail, HiveoryAgentRuntimeError> {
        self.store.update(request).await?;
        self.agent_detail(&request.agent_id).await
    }

    pub async fn archive_agent(
        &self,
        agent_id: &str,
        archived: bool,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        Ok(self.store.archive(agent_id, archived).await?)
    }

    pub async fn delete_agent(&self, agent_id: &str) -> Result<(), HiveoryAgentRuntimeError> {
        let runs = self.store.runs(Some(agent_id), None, 200).await?;
        for run in runs {
            if matches!(
                run.state,
                AgentRunState::Completed | AgentRunState::Failed | AgentRunState::Cancelled
            ) {
                continue;
            }
            if let Some(token) = self
                .cancellations
                .lock()
                .expect("agent cancellation lock")
                .get(&run.id)
            {
                token.cancel();
            }
            let _ = self
                .cancel_run(&AgentRunControlRequest { run_id: run.id })
                .await;
        }
        Ok(self.store.delete(agent_id).await?)
    }

    pub async fn add_folder(
        &self,
        request: &AgentFolderGrantRequest,
    ) -> Result<AgentFolderGrant, HiveoryAgentRuntimeError> {
        Ok(self.store.add_folder(request).await?)
    }

    pub async fn delete_folder(
        &self,
        request: &AgentFolderGrantDeleteRequest,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        Ok(self
            .store
            .delete_folder(&request.agent_id, &request.grant_id)
            .await?)
    }

    pub async fn set_skill(
        &self,
        request: &AgentSkillToggleRequest,
    ) -> Result<AgentDetail, HiveoryAgentRuntimeError> {
        self.store
            .set_skill_enabled(&request.agent_id, &request.skill_id, request.enabled)
            .await?;
        self.agent_detail(&request.agent_id).await
    }

    pub async fn set_skill_conflict(
        &self,
        request: &AgentSkillConflictResolutionRequest,
    ) -> Result<AgentDetail, HiveoryAgentRuntimeError> {
        self.store
            .set_skill_conflict(&request.agent_id, &request.trigger, &request.skill_id)
            .await?;
        self.agent_detail(&request.agent_id).await
    }

    pub async fn skill_catalog(&self) -> Result<AgentSkillCatalog, HiveoryAgentRuntimeError> {
        Ok(AgentSkillCatalog {
            skills: self.store.catalog().await?,
            conflicts: Vec::new(),
        })
    }

    pub async fn memory(
        &self,
        query: &AgentMemoryQuery,
    ) -> Result<Vec<AgentMemorySummary>, HiveoryAgentRuntimeError> {
        Ok(self.store.memory(query).await?)
    }

    pub async fn remember(
        &self,
        request: &AgentMemoryMutationRequest,
    ) -> Result<AgentMemorySummary, HiveoryAgentRuntimeError> {
        memory_is_eligible_for_explicit_storage(&request.content)
            .map_err(|error| HiveoryAgentRuntimeError::InvalidInput(error.to_string()))?;
        Ok(self.store.upsert_memory(request).await?)
    }

    pub async fn delete_memory(
        &self,
        request: &AgentMemoryDeleteRequest,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        Ok(self
            .store
            .delete_memory(&request.agent_id, &request.memory_id)
            .await?)
    }

    pub async fn conversations(
        &self,
        query: &AgentConversationQuery,
    ) -> Result<Vec<hiveory_protocol::AgentConversationSummary>, HiveoryAgentRuntimeError> {
        Ok(self.store.conversations(query).await?)
    }

    pub async fn create_conversation(
        &self,
        request: &AgentConversationCreateRequest,
    ) -> Result<AgentConversationDetail, HiveoryAgentRuntimeError> {
        Ok(self.store.create_conversation(request).await?)
    }

    pub async fn conversation(
        &self,
        conversation_id: &str,
    ) -> Result<AgentConversationDetail, HiveoryAgentRuntimeError> {
        Ok(self.store.conversation_detail(conversation_id).await?)
    }

    pub async fn run_detail(
        &self,
        run_id: &str,
    ) -> Result<AgentRunDetail, HiveoryAgentRuntimeError> {
        Ok(self.store.run_detail(run_id).await?)
    }

    pub async fn runs(
        &self,
        query: &hiveory_protocol::AgentRunsQuery,
    ) -> Result<Vec<AgentRunSummary>, HiveoryAgentRuntimeError> {
        Ok(self
            .store
            .runs(
                query.agent_id.as_deref(),
                query.state,
                query.limit.unwrap_or(100),
            )
            .await?)
    }

    pub async fn events(
        &self,
        query: &AgentEventsQuery,
    ) -> Result<Vec<AgentEventEnvelope>, HiveoryAgentRuntimeError> {
        Ok(self.store.events(query).await?)
    }

    pub async fn start_run(
        &self,
        request: &AgentRunStartRequest,
    ) -> Result<AgentRunSummary, HiveoryAgentRuntimeError> {
        let run = self.store.create_run(request).await?;
        self.store
            .save_continuation(
                &run.id,
                &[json!({ "role": "user", "content": request.prompt.trim() })],
                None,
            )
            .await?;
        self.spawn_run(run.id.clone());
        Ok(run)
    }

    pub async fn resume_run(
        &self,
        request: &AgentRunControlRequest,
    ) -> Result<AgentRunSummary, HiveoryAgentRuntimeError> {
        let run = self.store.run(&request.run_id).await?.ok_or_else(|| {
            HiveoryAgentRuntimeError::InvalidInput("run was not found".to_owned())
        })?;
        if !matches!(
            run.state,
            AgentRunState::Interrupted | AgentRunState::Queued
        ) {
            return Err(HiveoryAgentRuntimeError::InvalidInput(
                "only interrupted or queued runs can be resumed".to_owned(),
            ));
        }
        self.spawn_run(run.id.clone());
        Ok(run)
    }

    pub async fn cancel_run(
        &self,
        request: &AgentRunControlRequest,
    ) -> Result<AgentRunSummary, HiveoryAgentRuntimeError> {
        if let Some(token) = self
            .cancellations
            .lock()
            .expect("agent cancellation lock")
            .get(&request.run_id)
        {
            token.cancel();
        }
        let run = self.store.run(&request.run_id).await?.ok_or_else(|| {
            HiveoryAgentRuntimeError::InvalidInput("run was not found".to_owned())
        })?;
        if matches!(
            run.state,
            AgentRunState::Completed | AgentRunState::Failed | AgentRunState::Cancelled
        ) {
            return Ok(run);
        }
        Ok(self
            .store
            .transition_run(
                &run.id,
                AgentRunState::Cancelled,
                None,
                Some("cancelled by user"),
            )
            .await?)
    }

    pub async fn decide_approval(
        &self,
        request: &AgentApprovalDecisionRequest,
    ) -> Result<AgentRunSummary, HiveoryAgentRuntimeError> {
        let approval = self
            .store
            .resolve_approval(
                &request.approval_id,
                &request.fingerprint,
                request.decision,
                request.comment.as_deref(),
            )
            .await?;
        let call = self
            .store
            .tool_call_by_id(&approval.tool_call_id)
            .await?
            .ok_or_else(|| {
                HiveoryAgentRuntimeError::InvalidInput("tool call was not found".to_owned())
            })?;
        let run = self.store.run(&approval.run_id).await?.ok_or_else(|| {
            HiveoryAgentRuntimeError::InvalidInput("run was not found".to_owned())
        })?;
        let detail = self
            .scoped_detail_for_run(&run.id, self.agent_detail(&run.agent_id).await?)
            .await?;
        let (mut input_items, _) = self
            .store
            .load_continuation(&approval.run_id)
            .await?
            .ok_or_else(|| {
                HiveoryAgentRuntimeError::InvalidInput(
                    "approval continuation was not found".to_owned(),
                )
            })?;
        let output = if matches!(request.decision, AgentApprovalDecision::Approve) {
            self.store
                .update_tool_call(
                    &call.id,
                    AgentToolCallState::Approved,
                    Some(&approval.id),
                    None,
                    None,
                )
                .await?;
            self.store
                .update_tool_call(&call.id, AgentToolCallState::Executing, None, None, None)
                .await?;
            match self
                .execute_tool(&detail, &approval.run_id, &call.name, &call.arguments_json)
                .await
            {
                Ok(ToolExecution::Result(output)) => {
                    self.store
                        .update_tool_call(
                            &call.id,
                            AgentToolCallState::Completed,
                            None,
                            Some(&preview(&output)),
                            Some(&output),
                        )
                        .await?;
                    output
                }
                Ok(ToolExecution::RequestInput(_)) => {
                    return Err(HiveoryAgentRuntimeError::InvalidInput(
                        "an approved tool unexpectedly requested input".to_owned(),
                    ))
                }
                Err(error) => {
                    let output = json!({ "error": error }).to_string();
                    self.store
                        .update_tool_call(
                            &call.id,
                            AgentToolCallState::Failed,
                            None,
                            Some(&preview(&output)),
                            Some(&output),
                        )
                        .await?;
                    output
                }
            }
        } else {
            let output = json!({ "denied": true, "reason": request.comment }).to_string();
            self.store
                .update_tool_call(
                    &call.id,
                    AgentToolCallState::Denied,
                    Some(&approval.id),
                    Some(&preview(&output)),
                    Some(&output),
                )
                .await?;
            output
        };
        input_items.push(function_call_item(
            &call.call_id,
            &call.name,
            &call.arguments_json,
        ));
        input_items.push(function_output_item(&call.call_id, &output));
        self.store
            .save_continuation(&approval.run_id, &input_items, None)
            .await?;
        self.record_audit(
            "agent.approval.resolved",
            if matches!(request.decision, AgentApprovalDecision::Approve) {
                "approved"
            } else {
                "denied"
            },
            "warning",
            Some(&approval.run_id),
            Some(&approval.id),
            Some(&request.fingerprint),
        )
        .await;
        self.emit(
            &approval.run_id,
            AgentEventKind::ApprovalResolved,
            0,
            Some(&call.call_id),
            json!({ "approval_id": approval.id, "decision": request.decision }),
        )
        .await?;
        self.store.requeue_run(&approval.run_id).await?;
        self.spawn_run(approval.run_id.clone());
        self.store
            .run(&approval.run_id)
            .await?
            .ok_or_else(|| HiveoryAgentRuntimeError::InvalidInput("run was not found".to_owned()))
    }

    pub async fn submit_input(
        &self,
        request: &AgentInputRequest,
    ) -> Result<AgentRunSummary, HiveoryAgentRuntimeError> {
        if request.answer.trim().is_empty() {
            return Err(HiveoryAgentRuntimeError::InvalidInput(
                "answer is required".to_owned(),
            ));
        }
        let run = self.store.run(&request.run_id).await?.ok_or_else(|| {
            HiveoryAgentRuntimeError::InvalidInput("run was not found".to_owned())
        })?;
        if run.state != AgentRunState::AwaitingInput {
            return Err(HiveoryAgentRuntimeError::InvalidInput(
                "run is not awaiting input".to_owned(),
            ));
        }
        let (mut input_items, pending_call_id) = self
            .store
            .load_continuation(&run.id)
            .await?
            .ok_or_else(|| {
                HiveoryAgentRuntimeError::InvalidInput(
                    "input continuation was not found".to_owned(),
                )
            })?;
        let call_id = pending_call_id.ok_or_else(|| {
            HiveoryAgentRuntimeError::InvalidInput("input request has no tool call".to_owned())
        })?;
        let call = self
            .store
            .tool_call(&run.id, &call_id)
            .await?
            .ok_or_else(|| {
                HiveoryAgentRuntimeError::InvalidInput("input tool call was not found".to_owned())
            })?;
        let output = json!({ "answer": request.answer }).to_string();
        self.store
            .update_tool_call(
                &call.id,
                AgentToolCallState::Completed,
                None,
                Some(&preview(&request.answer)),
                Some(&output),
            )
            .await?;
        input_items.push(function_output_item(&call.call_id, &output));
        self.store
            .save_continuation(&run.id, &input_items, None)
            .await?;
        self.store.requeue_run(&run.id).await?;
        self.spawn_run(run.id.clone());
        self.store
            .run(&run.id)
            .await?
            .ok_or_else(|| HiveoryAgentRuntimeError::InvalidInput("run was not found".to_owned()))
    }

    pub async fn export_agent(
        &self,
        request: &AgentExportRequest,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        if request.destination.trim().is_empty() {
            return Err(HiveoryAgentRuntimeError::InvalidInput(
                "export destination is required".to_owned(),
            ));
        }
        let detail = self.agent_detail(&request.agent_id).await?;
        let memory = if request.include_memory {
            self.memory(&AgentMemoryQuery {
                agent_id: request.agent_id.clone(),
                search: None,
                class: None,
                limit: Some(200),
            })
            .await?
        } else {
            Vec::new()
        };
        let manifest =
            json!({ "format": "hiveory-agent", "version": 1, "agent": detail, "memory": memory })
                .to_string();
        self.artifacts
            .write_export(Path::new(&request.destination), &manifest, &[])
            .map_err(|error| HiveoryAgentRuntimeError::Artifact(error.to_string()))
    }

    fn spawn_run(&self, run_id: String) {
        let token = CancellationToken::new();
        self.cancellations
            .lock()
            .expect("agent cancellation lock")
            .insert(run_id.clone(), token.clone());
        let runtime = self.clone();
        tokio::spawn(async move {
            if let Err(error) = runtime.run_loop(&run_id, token).await {
                let should_mark_failed = !matches!(
                    error,
                    HiveoryAgentRuntimeError::Cancelled
                        | HiveoryAgentRuntimeError::Store(HiveoryAgentStoreError::StaleLease)
                );
                if should_mark_failed {
                    if let Ok(Some(run)) = runtime.store.run(&run_id).await {
                        if matches!(run.state, AgentRunState::Preparing | AgentRunState::Running) {
                            let message = error.to_string();
                            if runtime
                                .store
                                .transition_run(
                                    &run_id,
                                    AgentRunState::Failed,
                                    Some(run.lease_generation),
                                    Some(&message),
                                )
                                .await
                                .is_ok()
                            {
                                let _ = runtime
                                    .emit_state(
                                        &run_id,
                                        run.lease_generation,
                                        AgentRunState::Failed,
                                    )
                                    .await;
                            }
                        }
                    }
                }
            }
            runtime
                .cancellations
                .lock()
                .expect("agent cancellation lock")
                .remove(&run_id);
        });
    }

    async fn run_loop(
        &self,
        run_id: &str,
        cancellation: CancellationToken,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        let Some((run, lease)) = self.store.claim_run(run_id).await? else {
            return Ok(());
        };
        self.emit_state(run_id, lease, AgentRunState::Preparing)
            .await?;
        self.store
            .transition_run(run_id, AgentRunState::Running, Some(lease), None)
            .await?;
        self.emit_state(run_id, lease, AgentRunState::Running)
            .await?;
        let detail = self.agent_detail(&run.agent_id).await?;
        let mut instructions = detail.system_instructions.clone();
        if !detail.operating_brief.trim().is_empty() {
            instructions.push_str("\n\nOperating brief:\n");
            instructions.push_str(&detail.operating_brief);
        }
        if !detail.folders.is_empty() {
            instructions.push_str(
                "\n\nExplicit Agent folder grants (use the grant_id exactly as shown; never infer another root):\n",
            );
            for folder in &detail.folders {
                instructions.push_str(&format!(
                    "- {}: {} (read={}, write={})\n",
                    folder.id, folder.root_path, folder.read, folder.write
                ));
            }
        }
        for skill in detail
            .skills
            .iter()
            .filter(|skill| skill.enabled && skill.valid)
        {
            if let Some((_, body)) = self.store.skill_package(&skill.id).await? {
                instructions.push_str("\n\nLoaded skill: ");
                instructions.push_str(&skill.name);
                instructions.push('\n');
                instructions.push_str(&body);
                self.emit(
                    run_id,
                    AgentEventKind::SkillLoaded,
                    run.step_count,
                    None,
                    json!({ "skill_id": skill.id, "name": skill.name }),
                )
                .await?;
            }
        }
        let mut input_items = if let Some((items, _)) = self.store.load_continuation(run_id).await?
        {
            items
        } else {
            vec![json!({ "role": "user", "content": run.prompt_preview })]
        };
        self.retrieve_memory(&detail, &run, &mut instructions)
            .await?;
        let started = Instant::now();
        let mut step_count = run.step_count;
        loop {
            if cancellation.is_cancelled() {
                return self.cancelled_run(run_id, Some(lease)).await;
            }
            if started.elapsed()
                > Duration::from_secs(u64::from(detail.runtime_limits.max_duration_seconds))
            {
                return self
                    .fail_run(run_id, lease, "agent runtime duration limit reached")
                    .await;
            }
            if step_count >= detail.runtime_limits.max_steps {
                return self
                    .fail_run(run_id, lease, "agent step limit reached")
                    .await;
            }
            step_count += 1;
            self.store
                .increment_progress(run_id, lease, true, false)
                .await?;
            self.compact_if_needed(
                run_id,
                &mut input_items,
                detail.runtime_limits.max_context_tokens,
                step_count,
            )
            .await?;
            let provider_secret = self
                .store
                .persistence()
                .provider_secret_ref()
                .await
                .map_err(HiveoryAgentStoreError::Database)?
                .unwrap_or_default();
            let request = AgentModelTurnRequest {
                model: detail.summary.model.clone(),
                system_instructions: instructions.clone(),
                input_items_json: input_items.iter().map(Value::to_string).collect(),
                tools: detail.tools.clone(),
            };
            let (sender, mut receiver) = mpsc::unbounded_channel::<AgentProviderStreamEvent>();
            let callback = Arc::new(move |event: AgentProviderStreamEvent| {
                let _ = sender.send(event);
            });
            let provider_future = self.provider.stream_agent_turn(
                &provider_secret,
                request,
                cancellation.clone(),
                callback,
            );
            tokio::pin!(provider_future);
            let mut pending_call = None;
            let provider_result = loop {
                tokio::select! {
                    result = &mut provider_future => {
                        while let Ok(event) = receiver.try_recv() { if let Some(call) = self.handle_provider_event(run_id, lease, step_count, event).await? { pending_call = Some(call); } }
                        break result;
                    }
                    event = receiver.recv() => {
                        if let Some(event) = event { if let Some(call) = self.handle_provider_event(run_id, lease, step_count, event).await? { pending_call = Some(call); } }
                    }
                }
            };
            if let Err(error) = provider_result {
                if matches!(error, HiveoryProviderError::Cancelled) || cancellation.is_cancelled() {
                    return self.cancelled_run(run_id, Some(lease)).await;
                }
                return self.fail_run(run_id, lease, &error.to_string()).await;
            }
            let Some(call) = pending_call else {
                self.store
                    .transition_run(run_id, AgentRunState::Completed, Some(lease), None)
                    .await?;
                self.emit_state(run_id, lease, AgentRunState::Completed)
                    .await?;
                if matches!(
                    detail.memory_policy,
                    hiveory_protocol::AgentMemoryPolicy::IncludeSummaries
                ) {
                    let _ = self
                        .store
                        .upsert_memory(&AgentMemoryMutationRequest {
                            agent_id: detail.summary.id.clone(),
                            memory_id: None,
                            class: hiveory_protocol::AgentMemoryClass::RunSummary,
                            content: format!("Completed run {}: {}", run_id, run.prompt_preview),
                            source_type: "run_summary".to_owned(),
                            source_id: Some(run_id.to_owned()),
                            enabled: true,
                        })
                        .await;
                }
                return Ok(());
            };
            if self
                .store
                .run(run_id)
                .await?
                .map(|item| item.tool_call_count)
                .unwrap_or(0)
                >= detail.runtime_limits.max_tool_calls
            {
                return self
                    .fail_run(run_id, lease, "agent tool-call limit reached")
                    .await;
            }
            self.store
                .increment_progress(run_id, lease, false, true)
                .await?;
            self.process_tool_call(&detail, run_id, lease, &mut input_items, call, step_count)
                .await?;
            let state = self
                .store
                .run(run_id)
                .await?
                .ok_or_else(|| {
                    HiveoryAgentRuntimeError::InvalidInput(
                        "run disappeared during execution".to_owned(),
                    )
                })?
                .state;
            if matches!(
                state,
                AgentRunState::AwaitingApproval | AgentRunState::AwaitingInput
            ) {
                return Ok(());
            }
        }
    }

    async fn handle_provider_event(
        &self,
        run_id: &str,
        lease: u64,
        step: u32,
        event: AgentProviderStreamEvent,
    ) -> Result<Option<PendingFunctionCall>, HiveoryAgentRuntimeError> {
        match event.kind {
            AgentProviderStreamEventKind::TextDelta => {
                if let Some(text) = event.text {
                    self.store
                        .append_message(run_id, "assistant", "text_delta", &text, None)
                        .await?;
                    self.emit(
                        run_id,
                        AgentEventKind::AssistantTextDelta,
                        step,
                        None,
                        json!({ "text": text }),
                    )
                    .await?;
                }
            }
            AgentProviderStreamEventKind::ReasoningSummary => {
                if let Some(text) = event.text {
                    self.store
                        .append_message(run_id, "assistant", "reasoning_summary", &text, None)
                        .await?;
                    self.emit(
                        run_id,
                        AgentEventKind::ReasoningSummary,
                        step,
                        None,
                        json!({ "text": text }),
                    )
                    .await?;
                }
            }
            AgentProviderStreamEventKind::FunctionCall => {
                let call_id = event.call_id.unwrap_or_else(|| Uuid::now_v7().to_string());
                let name = event.name.unwrap_or_default();
                if name.trim().is_empty() {
                    return Err(HiveoryAgentRuntimeError::InvalidInput(
                        "provider returned a function call without a name".to_owned(),
                    ));
                }
                let arguments = event.arguments_json.unwrap_or_else(|| "{}".to_owned());
                return Ok(Some(PendingFunctionCall {
                    call_id: call_id.clone(),
                    name: name.clone(),
                    arguments_json: arguments.clone(),
                    item_json: event.item_json.unwrap_or_else(|| {
                        function_call_item(&call_id, &name, &arguments).to_string()
                    }),
                }));
            }
            AgentProviderStreamEventKind::Usage => {
                self.store
                    .set_usage(run_id, lease, event.input_tokens, event.output_tokens)
                    .await?;
                self.emit(run_id, AgentEventKind::UsageRecorded, step, None, json!({ "input_tokens": event.input_tokens, "output_tokens": event.output_tokens })).await?;
            }
            AgentProviderStreamEventKind::Completed => {
                if event.input_tokens.is_some() || event.output_tokens.is_some() {
                    self.store
                        .set_usage(run_id, lease, event.input_tokens, event.output_tokens)
                        .await?;
                }
            }
            AgentProviderStreamEventKind::OutputItem | AgentProviderStreamEventKind::Failed => {}
        }
        Ok(None)
    }

    async fn process_tool_call(
        &self,
        detail: &AgentDetail,
        run_id: &str,
        lease: u64,
        input_items: &mut Vec<Value>,
        call: PendingFunctionCall,
        step: u32,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        let Some(definition) = detail.tools.iter().find(|tool| tool.name == call.name) else {
            let output = json!({ "error": "tool is not enabled for this agent" }).to_string();
            input_items.push(serde_json::from_str(&call.item_json).unwrap_or_else(|_| {
                function_call_item(&call.call_id, &call.name, &call.arguments_json)
            }));
            input_items.push(function_output_item(&call.call_id, &output));
            self.store
                .save_continuation(run_id, input_items, None)
                .await?;
            return Ok(());
        };
        let stored = self
            .store
            .create_tool_call(
                run_id,
                &call.call_id,
                &call.name,
                &call.arguments_json,
                definition.risk,
            )
            .await?;
        if stored.state == AgentToolCallState::Completed {
            if let Some(result) = stored.result_preview.clone() {
                input_items.push(serde_json::from_str(&call.item_json).unwrap_or_else(|_| {
                    function_call_item(&call.call_id, &call.name, &call.arguments_json)
                }));
                input_items.push(function_output_item(&call.call_id, &result));
                self.store
                    .save_continuation(run_id, input_items, None)
                    .await?;
            }
            return Ok(());
        }
        self.emit(
            run_id,
            AgentEventKind::ToolCallProposed,
            step,
            Some(&call.call_id),
            json!({ "name": call.name, "arguments": call.arguments_json, "risk": definition.risk }),
        )
        .await?;
        let target = tool_target(&call.name, &call.arguments_json);
        let fingerprint = hiveory_approval_fingerprint(&call.name, &target, &call.arguments_json);
        let audit_context = format!("tool={}; fingerprint={fingerprint}", call.name);
        self.record_audit(
            "agent.tool.proposed",
            "pending",
            if definition.risk == AgentToolRisk::ReadOnly {
                "info"
            } else {
                "warning"
            },
            Some(run_id),
            Some(&target),
            Some(&audit_context),
        )
        .await;
        if matches!(detail.approval_policy, AgentApprovalPolicy::Deny) {
            let output =
                json!({ "denied": true, "reason": "agent policy denies this tool" }).to_string();
            self.store
                .update_tool_call(
                    &stored.id,
                    AgentToolCallState::Denied,
                    None,
                    Some(&preview(&output)),
                    Some(&output),
                )
                .await?;
            input_items.push(serde_json::from_str(&call.item_json).unwrap_or_else(|_| {
                function_call_item(&call.call_id, &call.name, &call.arguments_json)
            }));
            input_items.push(function_output_item(&call.call_id, &output));
            self.store
                .save_continuation(run_id, input_items, None)
                .await?;
            self.record_audit(
                "agent.tool.denied",
                "denied",
                "warning",
                Some(run_id),
                Some(&target),
                Some(&audit_context),
            )
            .await;
            return Ok(());
        }
        if tool_requires_approval(detail.approval_policy, definition.risk)
            && !approval_is_allowed(detail.approval_policy, definition.risk)
        {
            let approval = self
                .store
                .create_approval(
                    run_id,
                    &stored.id,
                    &call.name,
                    &target,
                    &call.arguments_json,
                    &fingerprint,
                    is_reversible(&call.name),
                )
                .await?;
            self.store
                .update_tool_call(
                    &stored.id,
                    AgentToolCallState::AwaitingApproval,
                    Some(&approval.id),
                    None,
                    None,
                )
                .await?;
            input_items.push(serde_json::from_str(&call.item_json).unwrap_or_else(|_| {
                function_call_item(&call.call_id, &call.name, &call.arguments_json)
            }));
            self.store
                .save_continuation(run_id, input_items, Some(&call.call_id))
                .await?;
            self.store
                .set_pending_approval(run_id, lease, Some(&approval.id))
                .await?;
            self.store
                .transition_run(run_id, AgentRunState::AwaitingApproval, Some(lease), None)
                .await?;
            self.record_audit(
                "agent.approval.requested",
                "pending",
                "warning",
                Some(run_id),
                Some(&target),
                Some(&audit_context),
            )
            .await;
            self.emit(run_id, AgentEventKind::ApprovalRequested, step, Some(&call.call_id), json!({ "approval_id": approval.id, "tool_name": call.name, "target": target, "fingerprint": fingerprint, "reversible": approval.reversible })).await?;
            return Ok(());
        }
        self.store
            .update_tool_call(&stored.id, AgentToolCallState::Executing, None, None, None)
            .await?;
        self.emit(
            run_id,
            AgentEventKind::ToolCallStarted,
            step,
            Some(&call.call_id),
            json!({ "name": call.name }),
        )
        .await?;
        self.record_audit(
            "agent.tool.started",
            "executing",
            "info",
            Some(run_id),
            Some(&target),
            Some(&audit_context),
        )
        .await;
        match self
            .execute_tool(detail, run_id, &call.name, &call.arguments_json)
            .await
        {
            Ok(ToolExecution::Result(output)) => {
                self.store
                    .update_tool_call(
                        &stored.id,
                        AgentToolCallState::Completed,
                        None,
                        Some(&preview(&output)),
                        Some(&output),
                    )
                    .await?;
                input_items.push(serde_json::from_str(&call.item_json).unwrap_or_else(|_| {
                    function_call_item(&call.call_id, &call.name, &call.arguments_json)
                }));
                input_items.push(function_output_item(&call.call_id, &output));
                self.store
                    .save_continuation(run_id, input_items, None)
                    .await?;
                self.emit(
                    run_id,
                    AgentEventKind::ToolCallCompleted,
                    step,
                    Some(&call.call_id),
                    json!({ "result": preview(&output) }),
                )
                .await?;
                self.record_audit(
                    "agent.tool.completed",
                    "completed",
                    "info",
                    Some(run_id),
                    Some(&target),
                    Some(&audit_context),
                )
                .await;
            }
            Ok(ToolExecution::RequestInput(prompt)) => {
                input_items.push(serde_json::from_str(&call.item_json).unwrap_or_else(|_| {
                    function_call_item(&call.call_id, &call.name, &call.arguments_json)
                }));
                self.store
                    .save_continuation(run_id, input_items, Some(&call.call_id))
                    .await?;
                self.store
                    .transition_run(run_id, AgentRunState::AwaitingInput, Some(lease), None)
                    .await?;
                self.emit(
                    run_id,
                    AgentEventKind::InputRequested,
                    step,
                    Some(&call.call_id),
                    json!({ "prompt": prompt }),
                )
                .await?;
            }
            Err(error) => {
                let output = json!({ "error": error }).to_string();
                self.store
                    .update_tool_call(
                        &stored.id,
                        AgentToolCallState::Failed,
                        None,
                        Some(&preview(&output)),
                        Some(&output),
                    )
                    .await?;
                input_items.push(serde_json::from_str(&call.item_json).unwrap_or_else(|_| {
                    function_call_item(&call.call_id, &call.name, &call.arguments_json)
                }));
                input_items.push(function_output_item(&call.call_id, &output));
                self.store
                    .save_continuation(run_id, input_items, None)
                    .await?;
                self.emit(
                    run_id,
                    AgentEventKind::ToolCallFailed,
                    step,
                    Some(&call.call_id),
                    json!({ "error": error }),
                )
                .await?;
                self.record_audit(
                    "agent.tool.failed",
                    "failed",
                    "warning",
                    Some(run_id),
                    Some(&target),
                    Some(&audit_context),
                )
                .await;
            }
        }
        Ok(())
    }

    async fn execute_tool(
        &self,
        detail: &AgentDetail,
        run_id: &str,
        name: &str,
        arguments_json: &str,
    ) -> Result<ToolExecution, String> {
        let scoped_detail = self
            .scoped_detail_for_run(run_id, (*detail).clone())
            .await
            .map_err(|error| error.to_string())?;
        let detail = &scoped_detail;
        let args: Value = serde_json::from_str(arguments_json)
            .map_err(|_| "tool arguments are not valid JSON".to_owned())?;
        if name.starts_with("plugin.") {
            let external_provider = self
                .external_tools
                .lock()
                .expect("agent external tool provider lock")
                .clone()
                .ok_or_else(|| "plugin runtime is unavailable".to_owned())?;
            let output = external_provider
                .execute(run_id, &detail.summary.id, name, &args.to_string())
                .await?;
            return Ok(ToolExecution::Result(output));
        }
        match name {
            "folder.list" => {
                let path = granted_path(detail, &args, false)?;
                let mut entries = Vec::new();
                for entry in fs::read_dir(path)
                    .map_err(|error| error.to_string())?
                    .flatten()
                    .take(MAX_DIRECTORY_ENTRIES)
                {
                    let path = entry.path();
                    let metadata =
                        fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
                    entries.push(json!({ "name": entry.file_name().to_string_lossy(), "kind": if metadata.is_dir() { "directory" } else if metadata.is_file() { "file" } else { "unsupported" }, "bytes": if metadata.is_file() { metadata.len() } else { 0 }}));
                }
                let truncated = entries.len() >= MAX_DIRECTORY_ENTRIES;
                Ok(ToolExecution::Result(
                    json!({ "entries": entries, "truncated": truncated }).to_string(),
                ))
            }
            "folder.read_text" => {
                let path = granted_path(detail, &args, false)?;
                let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
                if !metadata.is_file() || metadata.file_type().is_symlink() {
                    return Err("path is not a regular file".to_owned());
                }
                if metadata.len() > MAX_TEXT_READ_BYTES {
                    return Err("file is too large to read through the Agent tool".to_owned());
                }
                Ok(ToolExecution::Result(json!({ "content": fs::read_to_string(path).map_err(|error| error.to_string())? }).to_string()))
            }
            "folder.write_text" => {
                let path = granted_path(detail, &args, true);
                let content = args
                    .get("content")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "content is required".to_owned())?;
                if content.len() > MAX_TEXT_WRITE_BYTES {
                    return Err("content is too large to write through the Agent tool".to_owned());
                }
                let path = path?;
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                if path.exists()
                    && fs::symlink_metadata(&path)
                        .map_err(|error| error.to_string())?
                        .file_type()
                        .is_symlink()
                {
                    return Err("refusing to write through a symlink".to_owned());
                }
                fs::write(&path, content).map_err(|error| error.to_string())?;
                Ok(ToolExecution::Result(json!({ "written": true, "path": path.to_string_lossy(), "bytes": content.len() }).to_string()))
            }
            "memory.search" => {
                let query = args
                    .get("query")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let memories = self
                    .store
                    .memory(&AgentMemoryQuery {
                        agent_id: detail.summary.id.clone(),
                        search: Some(query),
                        class: None,
                        limit: Some(8),
                    })
                    .await
                    .map_err(|error| error.to_string())?;
                Ok(ToolExecution::Result(
                    serde_json::to_string(&memories).map_err(|error| error.to_string())?,
                ))
            }
            "memory.remember" => {
                let content = args
                    .get("content")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "content is required".to_owned())?;
                memory_is_eligible_for_explicit_storage(content)
                    .map_err(|error| error.to_string())?;
                let class = args
                    .get("class")
                    .and_then(Value::as_str)
                    .and_then(memory_class_from_value)
                    .unwrap_or(hiveory_protocol::AgentMemoryClass::AgentKnowledge);
                let memory = self
                    .store
                    .upsert_memory(&AgentMemoryMutationRequest {
                        agent_id: detail.summary.id.clone(),
                        memory_id: None,
                        class,
                        content: content.to_owned(),
                        source_type: "agent_tool".to_owned(),
                        source_id: Some(run_id.to_owned()),
                        enabled: true,
                    })
                    .await
                    .map_err(|error| error.to_string())?;
                Ok(ToolExecution::Result(
                    serde_json::to_string(&memory).map_err(|error| error.to_string())?,
                ))
            }
            "artifact.create_text" => {
                let name = args
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or("agent-output.txt");
                let content = args
                    .get("content")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "content is required".to_owned())?;
                let kind = match args.get("kind").and_then(Value::as_str) {
                    Some("json") => AgentArtifactKind::Json,
                    Some("markdown") => AgentArtifactKind::Markdown,
                    _ => AgentArtifactKind::Text,
                };
                let stored = self
                    .artifacts
                    .write_agent_text(run_id, name, content, kind)
                    .map_err(|error| error.to_string())?;
                let summary = AgentArtifactSummary {
                    id: Uuid::now_v7().to_string(),
                    run_id: run_id.to_owned(),
                    name: stored.name,
                    kind: stored.kind,
                    relative_path: stored.relative_path,
                    bytes: stored.bytes,
                    sha256: stored.sha256,
                    created_at_unix_ms: now_ms(),
                };
                self.store
                    .insert_artifact(&summary)
                    .await
                    .map_err(|error| error.to_string())?;
                self.emit(run_id, AgentEventKind::ArtifactCreated, 0, None, json!({ "artifact_id": summary.id, "name": summary.name, "relative_path": summary.relative_path })).await.map_err(|error| error.to_string())?;
                Ok(ToolExecution::Result(
                    serde_json::to_string(&summary).map_err(|error| error.to_string())?,
                ))
            }
            "user.request_input" => {
                let prompt = args
                    .get("prompt")
                    .and_then(Value::as_str)
                    .unwrap_or("The Agent needs more information.")
                    .trim();
                if prompt.is_empty() {
                    return Err("input prompt is required".to_owned());
                }
                Ok(ToolExecution::RequestInput(prompt.to_owned()))
            }
            "delegate_task" => {
                let prompt = args
                    .get("prompt")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "prompt is required".to_owned())?
                    .trim();
                if prompt.is_empty() {
                    return Err("prompt is required".to_owned());
                }
                let mut cursor = Some(run_id.to_owned());
                let mut depth = 0u8;
                while let Some(parent) = cursor {
                    depth = depth.saturating_add(1);
                    cursor = self
                        .store
                        .parent_run_id(&parent)
                        .await
                        .map_err(|error| error.to_string())?;
                    if depth > detail.runtime_limits.max_subagent_depth {
                        return Err("subagent depth limit reached".to_owned());
                    }
                }
                let active_children = self
                    .store
                    .active_child_run_count(run_id)
                    .await
                    .map_err(|error| error.to_string())?;
                if active_children >= u32::from(detail.runtime_limits.max_concurrent_subagents) {
                    return Err("concurrent subagent limit reached".to_owned());
                }
                let child = self
                    .store
                    .create_run(&AgentRunStartRequest {
                        agent_id: detail.summary.id.clone(),
                        conversation_id: None,
                        prompt: prompt.to_owned(),
                        background: true,
                        routine_execution_id: None,
                    })
                    .await
                    .map_err(|error| error.to_string())?;
                self.store
                    .save_continuation(
                        &child.id,
                        &[json!({ "role": "user", "content": prompt })],
                        None,
                    )
                    .await
                    .map_err(|error| error.to_string())?;
                self.store
                    .set_parent_run(&child.id, run_id)
                    .await
                    .map_err(|error| error.to_string())?;
                self.emit(
                    run_id,
                    AgentEventKind::ChildRunCreated,
                    0,
                    None,
                    json!({ "child_run_id": child.id }),
                )
                .await
                .map_err(|error| error.to_string())?;
                self.spawn_run(child.id.clone());
                Ok(ToolExecution::Result(
                    json!({ "child_run_id": child.id, "state": "queued" }).to_string(),
                ))
            }
            _ => Err("tool is not available".to_owned()),
        }
    }

    async fn scoped_detail_for_run(
        &self,
        run_id: &str,
        mut detail: AgentDetail,
    ) -> Result<AgentDetail, HiveoryAgentRuntimeError> {
        let Some(execution_id) = self.store.routine_execution_id(run_id).await? else {
            return Ok(detail);
        };
        let routine_store = HiveoryRoutineStore::new(self.store.persistence().clone());
        let execution = routine_store
            .execution_by_id(&execution_id)
            .await
            .map_err(|error| HiveoryAgentRuntimeError::InvalidInput(error.to_string()))?
            .ok_or_else(|| {
                HiveoryAgentRuntimeError::InvalidInput("routine execution was not found".to_owned())
            })?;
        let folder_grant_ids = execution
            .folder_grant_ids
            .into_iter()
            .collect::<HashSet<_>>();
        detail
            .folders
            .retain(|folder| folder_grant_ids.contains(&folder.id));
        let has_folder_grants = !detail.folders.is_empty();
        let plugin_tool_names = execution.plugin_tool_names;
        detail.tools.retain(|tool| {
            if tool.name.starts_with("folder.") {
                return has_folder_grants;
            }
            if let Some(tool_name) = tool.name.strip_prefix("plugin.") {
                let leaf = tool_name.rsplit('.').next().unwrap_or(tool_name);
                return plugin_tool_names
                    .iter()
                    .any(|allowed| allowed == &tool.name || allowed == leaf);
            }
            true
        });
        Ok(detail)
    }

    async fn retrieve_memory(
        &self,
        detail: &AgentDetail,
        run: &AgentRunSummary,
        instructions: &mut String,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        if matches!(
            detail.memory_policy,
            hiveory_protocol::AgentMemoryPolicy::Disabled
        ) {
            return Ok(());
        }
        let memories = self
            .store
            .memory(&AgentMemoryQuery {
                agent_id: detail.summary.id.clone(),
                search: None,
                class: None,
                limit: Some(8),
            })
            .await?;
        if memories.is_empty() {
            return Ok(());
        }
        instructions
            .push_str("\n\nRelevant durable memory (inspectable in the Agent memory panel):\n");
        for (rank, memory) in memories.iter().enumerate() {
            instructions.push_str(&format!("- [{}] {}\n", rank + 1, memory.content));
            self.store
                .record_memory_retrieval(
                    &run.id,
                    &memory.id,
                    (rank + 1) as u32,
                    "recent enabled memory",
                )
                .await?;
            self.emit(
                &run.id,
                AgentEventKind::MemoryRetrieved,
                run.step_count,
                None,
                json!({ "memory_id": memory.id, "rank": rank + 1 }),
            )
            .await?;
        }
        Ok(())
    }

    async fn compact_if_needed(
        &self,
        run_id: &str,
        input_items: &mut Vec<Value>,
        max_context_tokens: u32,
        step: u32,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        let approximate_tokens = input_items
            .iter()
            .map(|item| item.to_string().len() as u64)
            .sum::<u64>()
            / 4;
        if approximate_tokens <= u64::from(max_context_tokens) * 80 / 100 || input_items.len() <= 12
        {
            return Ok(());
        }
        let remove_count = input_items.len().saturating_sub(12);
        input_items.drain(0..remove_count);
        self.store
            .save_continuation(run_id, input_items, None)
            .await?;
        self.emit(
            run_id,
            AgentEventKind::CompactionCreated,
            step,
            None,
            json!({ "removed_items": remove_count }),
        )
        .await?;
        Ok(())
    }

    async fn emit_state(
        &self,
        run_id: &str,
        _lease: u64,
        state: AgentRunState,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        self.emit(
            run_id,
            AgentEventKind::RunStateChanged,
            0,
            None,
            json!({ "state": state }),
        )
        .await
    }
    async fn emit(
        &self,
        run_id: &str,
        kind: AgentEventKind,
        step: u32,
        tool_call_id: Option<&str>,
        payload: Value,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        let event = self
            .store
            .append_event(run_id, kind, step, tool_call_id, &payload.to_string())
            .await?;
        let _ = self.events.send(event);
        Ok(())
    }
    async fn record_audit(
        &self,
        action: &str,
        outcome: &str,
        severity: &str,
        run_id: Option<&str>,
        target: Option<&str>,
        redacted_context: Option<&str>,
    ) {
        let combined_target = match (run_id, target) {
            (Some(run_id), Some(target)) => Some(format!("run={run_id}; target={target}")),
            (Some(run_id), None) => Some(format!("run={run_id}")),
            (None, Some(target)) => Some(target.to_owned()),
            (None, None) => None,
        };
        let _ = self
            .audit
            .record(
                action,
                outcome,
                severity,
                combined_target.as_deref(),
                redacted_context,
            )
            .await;
    }
    async fn fail_run(
        &self,
        run_id: &str,
        lease: u64,
        error: &str,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        let message = error.chars().take(400).collect::<String>();
        let _ = self
            .store
            .transition_run(run_id, AgentRunState::Failed, Some(lease), Some(&message))
            .await?;
        self.emit_state(run_id, lease, AgentRunState::Failed)
            .await?;
        let _ = self
            .audit
            .record(
                "agent.run.failed",
                "failed",
                "error",
                Some(run_id),
                Some(&message),
            )
            .await;
        Ok(())
    }
    async fn cancelled_run(
        &self,
        run_id: &str,
        lease: Option<u64>,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        let current = self.store.run(run_id).await?.ok_or_else(|| {
            HiveoryAgentRuntimeError::InvalidInput("run was not found".to_owned())
        })?;
        if !matches!(
            current.state,
            AgentRunState::Completed | AgentRunState::Failed | AgentRunState::Cancelled
        ) {
            let _ = self
                .store
                .transition_run(run_id, AgentRunState::Cancelled, lease, Some("cancelled"))
                .await?;
            self.emit_state(
                run_id,
                lease.unwrap_or(current.lease_generation),
                AgentRunState::Cancelled,
            )
            .await?;
        }
        Ok(())
    }
}

pub fn builtin_tool_definitions() -> Vec<AgentToolDefinition> {
    vec![
        tool(
            "folder.list",
            "List entries in a folder explicitly granted to this Agent.",
            r#"{"type":"object","properties":{"path":{"type":"string"},"grant_id":{"type":["string","null"]}},"required":["path","grant_id"],"additionalProperties":false}"#,
            AgentToolRisk::ReadOnly,
        ),
        tool(
            "folder.read_text",
            "Read a UTF-8 text file from an explicitly granted folder.",
            r#"{"type":"object","properties":{"path":{"type":"string"},"grant_id":{"type":["string","null"]}},"required":["path","grant_id"],"additionalProperties":false}"#,
            AgentToolRisk::ReadOnly,
        ),
        tool(
            "folder.write_text",
            "Write UTF-8 text to a path in an explicitly writable folder.",
            r#"{"type":"object","properties":{"path":{"type":"string"},"content":{"type":"string"},"grant_id":{"type":["string","null"]}},"required":["path","content","grant_id"],"additionalProperties":false}"#,
            AgentToolRisk::FilesystemMutation,
        ),
        tool(
            "memory.search",
            "Search inspectable durable memory for this Agent.",
            r#"{"type":"object","properties":{"query":{"type":"string"}},"required":["query"],"additionalProperties":false}"#,
            AgentToolRisk::ReadOnly,
        ),
        tool(
            "memory.remember",
            "Store an explicit, non-sensitive memory for this Agent.",
            r#"{"type":"object","properties":{"class":{"type":["string","null"],"enum":["agent_knowledge","user_preference","run_summary","skill_observation",null]},"content":{"type":"string"}},"required":["class","content"],"additionalProperties":false}"#,
            AgentToolRisk::InternalMutation,
        ),
        tool(
            "artifact.create_text",
            "Create a text, Markdown, or JSON artifact in private Agent storage.",
            r#"{"type":"object","properties":{"name":{"type":["string","null"]},"kind":{"type":["string","null"],"enum":["text","markdown","json",null]},"content":{"type":"string"}},"required":["name","kind","content"],"additionalProperties":false}"#,
            AgentToolRisk::InternalMutation,
        ),
        tool(
            "user.request_input",
            "Pause the run and ask the user for a missing detail.",
            r#"{"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"],"additionalProperties":false}"#,
            AgentToolRisk::ReadOnly,
        ),
        tool(
            "delegate_task",
            "Start a bounded child Agent run with the same explicit permissions.",
            r#"{"type":"object","properties":{"prompt":{"type":"string"}},"required":["prompt"],"additionalProperties":false}"#,
            AgentToolRisk::ExternallyVisible,
        ),
    ]
}

fn tool(name: &str, description: &str, schema: &str, risk: AgentToolRisk) -> AgentToolDefinition {
    AgentToolDefinition {
        name: name.to_owned(),
        description: description.to_owned(),
        input_schema_json: schema.to_owned(),
        risk,
    }
}
fn granted_path(detail: &AgentDetail, args: &Value, write: bool) -> Result<PathBuf, String> {
    let requested = args.get("path").and_then(Value::as_str).unwrap_or(".");
    let grant_id = args.get("grant_id").and_then(Value::as_str);
    let grant = if let Some(grant_id) = grant_id {
        detail
            .folders
            .iter()
            .find(|grant| grant.id == grant_id)
            .ok_or_else(|| "folder grant was not found".to_owned())?
    } else if Path::new(requested).is_absolute() {
        detail
            .folders
            .iter()
            .find(|grant| requested.starts_with(&grant.root_path))
            .ok_or_else(|| "absolute path is outside the Agent folder grants".to_owned())?
    } else if detail.folders.len() == 1 {
        &detail.folders[0]
    } else {
        return Err("grant_id is required when an Agent has multiple folder grants".to_owned());
    };
    if write && !grant.write {
        return Err("folder grant is read-only".to_owned());
    }
    if !write && !grant.read {
        return Err("folder grant does not allow reads".to_owned());
    }
    let root = PathBuf::from(&grant.root_path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    let candidate = if Path::new(requested).is_absolute() {
        PathBuf::from(requested)
    } else {
        root.join(requested)
    };
    let resolved = if candidate.exists() {
        let metadata = fs::symlink_metadata(&candidate).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("symlink paths are not allowed".to_owned());
        }
        candidate
            .canonicalize()
            .map_err(|error| error.to_string())?
    } else {
        let parent = candidate
            .parent()
            .ok_or_else(|| "path has no parent".to_owned())?
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if !parent.starts_with(&root) {
            return Err("path is outside the Agent folder grant".to_owned());
        }
        parent.join(
            candidate
                .file_name()
                .ok_or_else(|| "path has no filename".to_owned())?,
        )
    };
    if !resolved.starts_with(&root) {
        return Err("path is outside the Agent folder grant".to_owned());
    }
    Ok(resolved)
}
fn function_call_item(call_id: &str, name: &str, arguments: &str) -> Value {
    json!({ "type": "function_call", "call_id": call_id, "name": name, "arguments": arguments })
}
fn function_output_item(call_id: &str, output: &str) -> Value {
    json!({ "type": "function_call_output", "call_id": call_id, "output": output })
}
fn tool_target(name: &str, arguments_json: &str) -> String {
    serde_json::from_str::<Value>(arguments_json)
        .ok()
        .and_then(|value| {
            value
                .get("path")
                .or_else(|| value.get("name"))
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .unwrap_or_else(|| name.to_owned())
}
fn is_reversible(name: &str) -> bool {
    matches!(name, "folder.write_text" | "memory.remember")
}
fn preview(value: &str) -> String {
    value.chars().take(600).collect()
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use hiveory_protocol::{
        AgentModelTurnRequest, AgentProviderStreamEvent, AgentProviderStreamEventKind,
        ChatModelTurnRequest, ChatProviderStreamEvent, ProviderDiagnosticRequest, SharedEventKind,
    };

    #[allow(dead_code)]
    struct MockProvider;
    #[async_trait]
    impl HiveoryModelProvider for MockProvider {
        async fn validate_credentials(&self, _: &str) -> Result<(), HiveoryProviderError> {
            Ok(())
        }
        async fn stream_diagnostic(
            &self,
            _: &str,
            _: ProviderDiagnosticRequest,
            _: CancellationToken,
            _: Arc<dyn Fn(SharedEventKind, Option<String>, Option<String>) + Send + Sync>,
        ) -> Result<hiveory_model_gateway::HiveoryProviderUsage, HiveoryProviderError> {
            Ok(hiveory_model_gateway::HiveoryProviderUsage {
                input_tokens: Some(1),
                output_tokens: Some(1),
            })
        }
        async fn stream_chat_turn(
            &self,
            _: &str,
            _: ChatModelTurnRequest,
            _: CancellationToken,
            _: Arc<dyn Fn(ChatProviderStreamEvent) + Send + Sync>,
        ) -> Result<(), HiveoryProviderError> {
            Ok(())
        }
        async fn stream_agent_turn(
            &self,
            _: &str,
            _: AgentModelTurnRequest,
            _: CancellationToken,
            on_event: Arc<dyn Fn(AgentProviderStreamEvent) + Send + Sync>,
        ) -> Result<(), HiveoryProviderError> {
            on_event(AgentProviderStreamEvent {
                provider_sequence: 1,
                kind: AgentProviderStreamEventKind::TextDelta,
                text: Some("Hello from the local mock.".to_owned()),
                call_id: None,
                name: None,
                arguments_json: None,
                item_json: None,
                input_tokens: Some(4),
                output_tokens: Some(3),
                error_code: None,
            });
            on_event(AgentProviderStreamEvent {
                provider_sequence: 2,
                kind: AgentProviderStreamEventKind::Completed,
                text: None,
                call_id: None,
                name: None,
                arguments_json: None,
                item_json: None,
                input_tokens: Some(4),
                output_tokens: Some(3),
                error_code: None,
            });
            Ok(())
        }
    }

    #[test]
    fn builtin_tool_contracts_are_strict_and_non_empty() {
        for tool in builtin_tool_definitions() {
            let schema: Value = serde_json::from_str(&tool.input_schema_json).expect("schema JSON");
            assert_eq!(schema["additionalProperties"], false);
            let properties = schema["properties"].as_object().expect("object properties");
            let required = schema["required"].as_array().expect("required properties");
            for property in properties.keys() {
                assert!(
                    required
                        .iter()
                        .any(|value| value.as_str() == Some(property)),
                    "strict schema must require {property} for {}",
                    tool.name
                );
            }
        }
    }
}
