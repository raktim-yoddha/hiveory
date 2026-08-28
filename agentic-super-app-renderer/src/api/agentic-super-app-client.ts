import { Channel, invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'

export type ApplicationMode = 'agent' | 'code' | 'chat'
export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type ChatReasoningEffort = 'auto' | 'low' | 'medium' | 'high'
export type ChatTurnState = 'queued' | 'streaming' | 'cancel_requested' | 'cancelled' | 'completed' | 'failed' | 'interrupted'
export type ProviderAccountSummary = { id: string; display_name: string; default_model: string | null; secret_configured: boolean; enabled: boolean }
export type JobSummary = { id: string; kind: string; state: JobState; created_at_unix_ms: number; updated_at_unix_ms: number; error_code: string | null }
export type NotificationSummary = { id: string; title: string; body: string; severity: string; read: boolean; created_at_unix_ms: number }
export type SharedEventEnvelope = { sequence: number; emitted_at_unix_ms: number; kind: string; job_id: string | null; message: string | null; text_delta: string | null; native_notification: boolean }
export type DiagnosticSnapshot = { providers: ProviderAccountSummary[]; recent_jobs: JobSummary[]; notifications: NotificationSummary[]; recovery_message: string | null }
export type BootstrapSnapshot = { protocol: { major: number }; active_mode: ApplicationMode; product_name: string }
export type UpdateSnapshot = { configured: boolean; current_version: string; available_version: string | null; notes: string | null; published_at: string | null; status: string }
export type BackupSummary = { path: string; bytes: number; created_at_unix_ms: number; includes_database: boolean; artifact_count: number }
export type BuildInformation = { product_name: string; version: string; protocol: { major: number } }

export type AgentApprovalPolicy = 'always_ask' | 'ask_for_mutations' | 'allow_within_scope' | 'deny'
export type AgentMemoryPolicy = 'disabled' | 'explicit_only' | 'include_summaries'
export type AgentRunState = 'queued' | 'preparing' | 'running' | 'awaiting_approval' | 'awaiting_input' | 'interrupted' | 'completed' | 'failed' | 'cancelled'
export type AgentToolRisk = 'read_only' | 'internal_mutation' | 'filesystem_mutation' | 'externally_visible'
export type AgentToolCallState = 'proposed' | 'awaiting_approval' | 'approved' | 'executing' | 'completed' | 'denied' | 'failed' | 'cancelled'
export type AgentApprovalDecision = 'approve' | 'deny'
export type AgentMemoryClass = 'agent_knowledge' | 'user_preference' | 'run_summary' | 'skill_observation'
export type AgentSkillOrigin = 'builtin' | 'application_data' | 'configured_directory'
export type AgentArtifactKind = 'text' | 'json' | 'markdown'
export type AgentEventKind = 'run_state_changed' | 'assistant_text_delta' | 'reasoning_summary' | 'tool_call_proposed' | 'tool_call_started' | 'tool_call_completed' | 'tool_call_failed' | 'approval_requested' | 'approval_resolved' | 'input_requested' | 'skill_loaded' | 'memory_retrieved' | 'artifact_created' | 'child_run_created' | 'compaction_created' | 'usage_recorded'
export type AgentRuntimeLimits = { max_steps: number; max_tool_calls: number; max_duration_seconds: number; max_context_tokens: number; max_subagent_depth: number; max_concurrent_subagents: number }
export type AgentSummary = { id: string; name: string; description: string; avatar_color: string; provider_account_id: string; model: string; version: number; archived: boolean; active_run_state: AgentRunState | null; enabled_skill_count: number; enabled_tool_count: number; folder_grant_count: number; created_at_unix_ms: number; updated_at_unix_ms: number }
export type AgentFolderGrant = { id: string; agent_id: string; display_name: string; root_path: string; read: boolean; write: boolean; created_at_unix_ms: number }
export type AgentToolDefinition = { name: string; description: string; input_schema_json: string; risk: AgentToolRisk }
export type AgentSkillSummary = { id: string; name: string; version: string; description: string; origin: AgentSkillOrigin; source_path: string; triggers: string[]; permissions: string[]; enabled: boolean; valid: boolean; validation_message: string | null }
export type AgentSkillConflict = { trigger: string; skill_ids: string[]; selected_skill_id: string | null }
export type AgentMemorySummary = { id: string; agent_id: string; class: AgentMemoryClass; content: string; source_type: string; source_id: string | null; enabled: boolean; created_at_unix_ms: number; updated_at_unix_ms: number }
export type AgentArtifactSummary = { id: string; run_id: string; name: string; kind: AgentArtifactKind; relative_path: string; bytes: number; sha256: string; created_at_unix_ms: number }
export type AgentToolCallSummary = { id: string; run_id: string; call_id: string; name: string; arguments_json: string; risk: AgentToolRisk; state: AgentToolCallState; approval_id: string | null; result_preview: string | null; created_at_unix_ms: number; updated_at_unix_ms: number }
export type AgentApprovalSummary = { id: string; run_id: string; tool_call_id: string; tool_name: string; target: string; arguments_json: string; fingerprint: string; reversible: boolean; state: string; created_at_unix_ms: number; resolved_at_unix_ms: number | null }
export type AgentRunSummary = { id: string; agent_id: string; agent_version: number; conversation_id: string; state: AgentRunState; prompt_preview: string; background: boolean; step_count: number; tool_call_count: number; pending_approval_id: string | null; lease_generation: number; input_tokens: number | null; output_tokens: number | null; error: string | null; created_at_unix_ms: number; updated_at_unix_ms: number; completed_at_unix_ms: number | null }
export type AgentMessage = { id: string; run_id: string; role: string; kind: string; content: string; tool_call_id: string | null; created_at_unix_ms: number }
export type AgentRunDetail = { summary: AgentRunSummary; messages: AgentMessage[]; tool_calls: AgentToolCallSummary[]; approvals: AgentApprovalSummary[]; skills: AgentSkillSummary[]; memories: AgentMemorySummary[]; artifacts: AgentArtifactSummary[]; child_runs: AgentRunSummary[]; event_cursor: number }
export type AgentDetail = { summary: AgentSummary; operating_brief: string; system_instructions: string; approval_policy: AgentApprovalPolicy; memory_policy: AgentMemoryPolicy; runtime_limits: AgentRuntimeLimits; folders: AgentFolderGrant[]; tools: AgentToolDefinition[]; skills: AgentSkillSummary[]; conflicts: AgentSkillConflict[]; recent_runs: AgentRunSummary[] }
export type AgentDashboard = { agents: AgentSummary[]; active_runs: AgentRunSummary[]; pending_approvals: AgentApprovalSummary[]; recent_runs: AgentRunSummary[] }
export type AgentCreateRequest = { name: string; description: string; operating_brief: string; avatar_color: string; provider_account_id: string; model: string; system_instructions: string; approval_policy: AgentApprovalPolicy; memory_policy: AgentMemoryPolicy; runtime_limits: AgentRuntimeLimits }
export type AgentUpdateRequest = AgentCreateRequest & { agent_id: string }
export type AgentFolderGrantRequest = { agent_id: string; path: string; read: boolean; write: boolean }
export type AgentFolderGrantDeleteRequest = { agent_id: string; grant_id: string }
export type AgentSkillToggleRequest = { agent_id: string; skill_id: string; enabled: boolean }
export type AgentSkillConflictResolutionRequest = { agent_id: string; trigger: string; skill_id: string }
export type AgentMemoryQuery = { agent_id: string; search: string | null; class: AgentMemoryClass | null; limit: number | null }
export type AgentMemoryMutationRequest = { agent_id: string; memory_id: string | null; class: AgentMemoryClass; content: string; source_type: string; source_id: string | null; enabled: boolean }
export type AgentMemoryDeleteRequest = { agent_id: string; memory_id: string }
export type AgentRunStartRequest = { agent_id: string; conversation_id: string | null; prompt: string; background: boolean; routine_execution_id?: string | null }
export type AgentRunControlRequest = { run_id: string }
export type AgentApprovalDecisionRequest = { run_id: string; approval_id: string; fingerprint: string; decision: AgentApprovalDecision; comment: string | null }
export type AgentInputRequest = { run_id: string; answer: string }
export type AgentRunsQuery = { agent_id: string | null; state: AgentRunState | null; limit: number | null }
export type AgentEventsQuery = { run_id: string; after_sequence: number; limit: number | null }
export type AgentEventEnvelope = { run_id: string; sequence: number; event_id: string; kind: AgentEventKind; step: number; tool_call_id: string | null; payload: string; emitted_at_unix_ms: number }
export type AgentSkillCatalog = { skills: AgentSkillSummary[]; conflicts: AgentSkillConflict[] }
export type AgentExportRequest = { agent_id: string; destination: string; include_memory: boolean }
export type AgentConversationSummary = { id: string; agent_id: string; title: string; message_count: number; updated_at_unix_ms: number }
export type AgentConversationDetail = { id: string; agent_id: string; title: string; messages: AgentMessage[]; runs: AgentRunSummary[]; draft: string; updated_at_unix_ms: number }
export type AgentConversationQuery = { agent_id: string; limit: number | null }
export type AgentConversationCreateRequest = { agent_id: string; title: string | null }

export type RoutineCatchUpPolicy = 'skip' | 'run_latest' | 'run_all_bounded'
export type RoutineConcurrencyPolicy = 'skip' | 'queue_one' | 'parallel_bounded'
export type RoutineSchedule = { expression: string; timezone: string }
export type RoutineDeliveryDestination = 'in_app' | 'in_app_and_native'
export type RoutineExecutionState = 'queued' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'skipped' | 'interrupted' | 'unknown_outcome'
export type RoutineSummary = { id: string; name: string; description: string; agent_id: string; agent_name: string; schedule: RoutineSchedule; enabled: boolean; archived: boolean; catch_up: RoutineCatchUpPolicy; concurrency: RoutineConcurrencyPolicy; delivery: RoutineDeliveryDestination; next_run_unix_ms: number | null; last_run_unix_ms: number | null; last_execution_state: RoutineExecutionState | null; created_at_unix_ms: number; updated_at_unix_ms: number }
export type RoutineExecution = { id: string; routine_id: string; run_id: string | null; occurrence_key: string; scheduled_for_unix_ms: number; state: RoutineExecutionState; folder_grant_ids: string[]; plugin_tool_names: string[]; error: string | null; report: string | null; created_at_unix_ms: number; updated_at_unix_ms: number; started_at_unix_ms: number | null; completed_at_unix_ms: number | null }
export type RoutineDetail = { summary: RoutineSummary; prompt_template: string; folder_grant_ids: string[]; plugin_tool_names: string[]; max_duration_seconds: number; max_tool_calls: number; approval_timeout_seconds: number; executions: RoutineExecution[] }
export type RoutineCreateRequest = { name: string; description: string; agent_id: string; prompt_template: string; schedule: RoutineSchedule; enabled: boolean; catch_up: RoutineCatchUpPolicy; concurrency: RoutineConcurrencyPolicy; delivery: RoutineDeliveryDestination; folder_grant_ids: string[]; plugin_tool_names: string[]; max_duration_seconds: number; max_tool_calls: number; approval_timeout_seconds: number }
export type RoutineUpdateRequest = RoutineCreateRequest & { routine_id: string }
export type RoutineQuery = { enabled: boolean | null; include_archived: boolean; limit: number | null }
export type RoutineExecutionsQuery = { routine_id: string; limit: number | null }

export type PluginAdapterKind = 'json_http_get' | 'json_http_post'
export type PluginConnectionKind = 'none' | 'api_key_header'
export type PluginPermission = { capability: string; explanation: string }
export type PluginToolDefinition = { name: string; description: string; input_schema_json: string; output_schema_json: string; risk: AgentToolRisk }
export type PluginManifest = { id: string; publisher: string; version: string; name: string; description: string; adapter: PluginAdapterKind; tools: PluginToolDefinition[]; permissions: PluginPermission[]; allowed_hosts: string[]; connection_kind: PluginConnectionKind; supports_dry_run: boolean; content_hash: string }
export type PluginCatalogEntry = { manifest: PluginManifest; installed: boolean; enabled: boolean; connection_count: number; assigned_agent_count: number }
export type PluginConnectionSummary = { id: string; plugin_id: string; name: string; origin: string; kind: PluginConnectionKind; api_key_header: string | null; secret_configured: boolean; validated_at_unix_ms: number | null; created_at_unix_ms: number; updated_at_unix_ms: number }
export type PluginInstallRequest = { plugin_id: string; enabled: boolean }
export type PluginConnectionCreateRequest = { plugin_id: string; name: string; origin: string; kind: PluginConnectionKind; api_key_header: string | null; secret_value: string | null }
export type PluginConnectionUpdateRequest = { connection_id: string; name: string; origin: string; api_key_header: string | null; secret_value: string | null }
export type AgentPluginGrant = { agent_id: string; plugin_id: string; connection_id: string; tool_names: string[]; enabled: boolean }
export type AgentPluginGrantRequest = AgentPluginGrant
export type PluginDryRunRequest = { plugin_id: string; connection_id: string; tool_name: string; arguments_json: string }
export type PluginInvocationSummary = { id: string; run_id: string | null; plugin_id: string; connection_id: string; tool_name: string; state: string; target: string; request_preview: string; response_preview: string | null; error: string | null; created_at_unix_ms: number; completed_at_unix_ms: number | null }

export type CodeWorkspaceTrust = 'untrusted' | 'trusted'
export type CodeWorkspaceCapability = 'read_files' | 'write_files' | 'execute_processes' | 'read_git' | 'open_preview'
export type CodeWorkspaceSummary = { id: string; host_id: string; display_name: string; root_path: string; repository_name: string | null; branch: string | null; is_git_repository: boolean; trust: CodeWorkspaceTrust; capabilities: CodeWorkspaceCapability[]; updated_at_unix_ms: number }
export type CodeWorkspaceDetail = { summary: CodeWorkspaceSummary; layout: CodePaneLayout; open_documents: CodeDocumentSummary[]; terminals: CodeTerminalSummary[]; previews: CodePreviewSummary[] }
export type CodeSnapshot = { workspaces: CodeWorkspaceSummary[]; active_workspace_id: string | null; adapters: CodeAdapterSummary[] }
export type CodeFileKind = 'file' | 'directory' | 'symlink' | 'binary'
export type CodeFileNode = { name: string; relative_path: string; kind: CodeFileKind; size: number | null; language: string | null; modified_at_unix_ms: number | null }
export type CodeFileTree = { workspace_id: string; directory: string; entries: CodeFileNode[]; truncated: boolean }
export type CodeDocumentSummary = { relative_path: string; language: string | null; last_fingerprint: string | null; last_opened_at_unix_ms: number }
export type CodeDocument = { workspace_id: string; relative_path: string; content: string; language: string | null; fingerprint: string; bytes: number; read_only: boolean; binary: boolean }
export type CodePaneKind = 'terminal' | 'coding_agent' | 'editor' | 'diff' | 'preview' | 'problems' | 'empty' | 'thread'
export type CodePaneOrientation = 'horizontal' | 'vertical'
export type CodePanePlacement = 'center' | 'left' | 'right' | 'top' | 'bottom'
export type CodePanePreset = 'equal_columns' | 'equal_rows' | 'main_left' | 'main_top' | 'grid' | 'tidy'
export type CodePaneMutation =
  | { type: 'split'; pane_id: string; placement: CodePanePlacement }
  | { type: 'rename'; pane_id: string; title: string }
  | { type: 'move'; pane_id: string; target_pane_id: string; placement: CodePanePlacement }
  | { type: 'resize'; split_id: string; ratio_percent: number }
  | { type: 'focus'; pane_id: string }
  | { type: 'maximize'; pane_id: string | null }
  | { type: 'apply_preset'; preset: CodePanePreset; primary_pane_id?: string | null }

export type CodePaneMutationRequest = { workspace_id: string; expected_revision: number; mutation: CodePaneMutation }
export type CodePaneMutationResult = { layout: CodePaneLayout }
export type LaunchCodePaneTerminalRequest = { workspace_id: string; pane_id: string; expected_revision: number; kind: CodeTerminalKind; adapter_id: string | null; model: string | null; cols: number; rows: number }
export type LaunchCodePaneTerminalResult = { layout: CodePaneLayout; terminal: CodeTerminalSummary }
export type OpenCodePanePreviewRequest = { workspace_id: string; pane_id: string; expected_revision: number; url: string }
export type OpenCodePanePreviewResult = { layout: CodePaneLayout; preview: CodePreviewSummary }
export type CreateCodePaneThreadRequest = { workspace_id: string; pane_id: string; expected_revision: number }
export type CreateCodePaneThreadResult = { layout: CodePaneLayout; conversation: ChatConversationDetail }
export type CloseCodePaneRequest = { workspace_id: string; pane_id: string; expected_revision: number; terminate_running_resource: boolean }
export type CodeTerminalSnapshot = { summary: CodeTerminalSummary; cols: number; rows: number; output_base64: string; sequence: number }

export type CodePaneNode = { pane_id: string; parent_id: string | null; kind: CodePaneKind; orientation: CodePaneOrientation | null; ratio_percent: number | null; children: string[]; resource_id: string | null; title?: string | null }
export type CodePaneLayout = { workspace_id: string; version: number; root_id: string; nodes: CodePaneNode[]; revision?: number; focused_pane_id?: string | null; maximized_pane_id?: string | null }
export type CodeTerminalKind = 'shell' | 'coding_agent'
export type CodeTerminalState = 'starting' | 'running' | 'exited' | 'failed' | 'interrupted' | 'dormant'
export type CodeTerminalSummary = { id: string; workspace_id: string; kind: CodeTerminalKind; state: CodeTerminalState; pid: number | null; adapter_id: string | null; model: string | null; session_id: string | null; exit_code: number | null; started_at_unix_ms: number; updated_at_unix_ms: number }
export type CodeTerminalEventKind = 'started' | 'output' | 'exited' | 'error'
export type CodeTerminalEvent = { terminal_id: string; sequence: number; kind: CodeTerminalEventKind; data_base64: string | null; exit_code: number | null; message: string | null; emitted_at_unix_ms: number }
export type CodeAdapterCapability = 'resume' | 'model_selection' | 'reasoning_effort' | 'permission_modes'
export type CodeAdapterSummary = { id: string; display_name: string; executable: string; detected: boolean; authenticated: boolean; capabilities: CodeAdapterCapability[] }
export type CodeGitFileStatus = { relative_path: string; status: string; staged: boolean; conflict: boolean }
export type CodeGitStatus = { workspace_id: string; branch: string | null; ahead: number; behind: number; files: CodeGitFileStatus[] }
export type CodeGitDiff = { workspace_id: string; relative_path: string | null; content: string; binary: boolean; truncated: boolean }
export type CodePreviewState = 'open' | 'closed' | 'blocked'
export type CodePreviewSummary = { id: string; workspace_id: string; url: string; origin: string; state: CodePreviewState }
export type CodeRunState = 'draft' | 'ready' | 'running' | 'paused' | 'blocked' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type CodeTaskState = 'draft' | 'blocked' | 'ready' | 'preparing' | 'running' | 'awaiting_input' | 'awaiting_review' | 'completed' | 'failed' | 'cancelled'
export type CodeDispatchState = 'preparing' | 'running' | 'awaiting_input' | 'checkpointing' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted' | 'stale'
export type CodeReviewPolicy = 'manual' | 'automatic'
export type CodeReviewDecision = 'accept' | 'request_changes' | 'reject'
export type CodeCheckpointKind = 'source' | 'result' | 'integration'
export type CodeCheckpointState = 'creating' | 'ready' | 'failed'
export type CodeManagedWorktreeState = 'provisioning' | 'ready' | 'cleanup_pending' | 'removed' | 'failed'
export type CodeOrchestrationMessageKind = 'status' | 'heartbeat' | 'question' | 'answer' | 'escalation' | 'progress' | 'completion'
export type CodeOrchestrationEventOrigin = 'host' | 'worker'
export const CODEX_ADAPTER_ID = 'codex-cli'
export const CLAUDE_CODE_ADAPTER_ID = 'claude-code'
export const ANTIGRAVITY_ADAPTER_ID = 'antigravity'
export const OPENCODE_ADAPTER_ID = 'opencode'
export const CODE_ADAPTER_IDS = [CODEX_ADAPTER_ID, CLAUDE_CODE_ADAPTER_ID, ANTIGRAVITY_ADAPTER_ID, OPENCODE_ADAPTER_ID] as const
export type CodeRunSummary = { id: string; workspace_id: string; title: string; objective: string; model: string | null; coordinator_id: string; adapter_id: string; state: CodeRunState; review_policy: CodeReviewPolicy; concurrency_limit: number; host_concurrency_cap: number; task_count: number; completed_tasks: number; active_dispatches: number; created_at_unix_ms: number; updated_at_unix_ms: number; error: string | null }
export type CodeTask = { id: string; run_id: string; client_id: string; title: string; specification: string; state: CodeTaskState; position: number; active_dispatch_id: string | null; latest_checkpoint_id: string | null; base_checkpoint_id: string | null; attempt: number; error: string | null; created_at_unix_ms: number; updated_at_unix_ms: number }
export type CodeTaskDependency = { run_id: string; task_id: string; depends_on_task_id: string }
export type CodeDispatch = { id: string; run_id: string; task_id: string; attempt: number; state: CodeDispatchState; adapter_id: string; lease_generation: number; session_id: string | null; pid: number | null; worktree_id: string | null; checkpoint_id: string | null; last_heartbeat_at_unix_ms: number | null; terminal_id: string | null; cancel_requested_at_unix_ms: number | null; started_at_unix_ms: number; updated_at_unix_ms: number; error: string | null; result_summary: string | null }
export type CodeManagedWorktree = { id: string; run_id: string; task_id: string; dispatch_id: string; path: string; branch: string; base_checkpoint_id: string | null; state: CodeManagedWorktreeState; dirty: boolean; locked: boolean; error: string | null; created_at_unix_ms: number; updated_at_unix_ms: number }
export type CodeCheckpoint = { id: string; run_id: string; task_id: string | null; dispatch_id: string | null; kind: CodeCheckpointKind; state: CodeCheckpointState; ref_name: string; commit_oid: string | null; parent_checkpoint_id: string | null; summary: string; created_at_unix_ms: number }
export type CodeReview = { id: string; run_id: string; task_id: string; checkpoint_id: string; decision: CodeReviewDecision; feedback: string | null; created_at_unix_ms: number }
export type CodeQuestion = { id: string; run_id: string; task_id: string; dispatch_id: string; prompt: string; answer: string | null; answered: boolean; created_at_unix_ms: number }
export type CodeOrchestrationMessage = { id: string; run_id: string; task_id: string | null; dispatch_id: string | null; kind: CodeOrchestrationMessageKind; question_id: string | null; payload: string; created_at_unix_ms: number }
export type CodeOrchestrationEventEnvelope = { run_id: string; sequence: number; event_id: string; task_id: string | null; dispatch_id: string | null; lease_generation: number; kind: CodeOrchestrationMessageKind; payload: string; accepted: boolean; origin: CodeOrchestrationEventOrigin; worker_sequence: number | null; nonce: string | null; emitted_at_unix_ms: number }
export type CodeDagProposalTask = { client_id: string; title: string; specification: string; depends_on: string[] }
export type CodeDagProposal = { objective: string; tasks: CodeDagProposalTask[]; warnings: string[] }
export type CodeRunDetail = { summary: CodeRunSummary; tasks: CodeTask[]; dependencies: CodeTaskDependency[]; dispatches: CodeDispatch[]; worktrees: CodeManagedWorktree[]; checkpoints: CodeCheckpoint[]; reviews: CodeReview[]; questions: CodeQuestion[]; messages: CodeOrchestrationMessage[]; events: CodeOrchestrationEventEnvelope[]; event_cursor: number; proposal: CodeDagProposal | null }

export type ChatAttachmentSummary = { id: string; display_name: string; mime_type: string; bytes: number; sha256: string }
export type ChatMessagePart =
  | { kind: 'text'; text: string }
  | { kind: 'reasoning_summary'; text: string }
  | { kind: 'status'; code: string; text: string }
  | { kind: 'error'; code: string; message: string }
  | { kind: 'attachment'; attachment: ChatAttachmentSummary }
  | { kind: 'image'; attachment: ChatAttachmentSummary }
  | { kind: 'citation'; url: string; title: string | null }
  | { kind: 'usage'; input_tokens: number | null; output_tokens: number | null }
  | { kind: 'tool_call'; call_id: string; name: string; arguments_json: string }
  | { kind: 'tool_result'; call_id: string; result: string }
export type ChatMessage = { id: string; branch_id: string; role: 'user' | 'assistant' | 'system'; parts: ChatMessagePart[]; created_at_unix_ms: number; turn_id: string | null }
export type ChatBranchSummary = { id: string; parent_branch_id: string | null; forked_after_message_id: string | null; label: string; created_at_unix_ms: number; active: boolean }
export type ChatTurnSummary = { id: string; message_id: string; assistant_message_id: string; branch_id: string; provider_account_id: string; model: string; reasoning_effort: ChatReasoningEffort; state: ChatTurnState; job_id: string | null; input_tokens: number | null; output_tokens: number | null; created_at_unix_ms: number; updated_at_unix_ms: number }
export type ChatConversationSummary = { id: string; title: string; active_branch_id: string; pinned: boolean; archived: boolean; updated_at_unix_ms: number; preview: string | null }
export type ChatConversationDetail = { id: string; title: string; active_branch_id: string; pinned: boolean; archived: boolean; branches: ChatBranchSummary[]; messages: ChatMessage[]; turns: ChatTurnSummary[]; draft: string; event_cursor: number; created_at_unix_ms: number; updated_at_unix_ms: number }
export type ChatSidebarPage = { conversations: ChatConversationSummary[]; next_cursor: string | null }
export type ChatEventEnvelope = { global_sequence: number; aggregate_sequence: number; conversation_id: string; branch_id: string | null; turn_id: string | null; message_id: string | null; kind: string; text_delta: string | null; message: string | null; emitted_at_unix_ms: number }

type ProtocolVersion = { major: number; minor?: number; patch?: number }
type CommandEnvelope<T> = { protocol: ProtocolVersion; request_id: string; payload: T }
type ResponseEnvelope<T> = { protocol: ProtocolVersion; request_id: string; payload: T }
type ChatCreateRequest = { title: string | null }
type ChatMetadataRequest = { conversation_id: string; title: string | null; pinned: boolean | null; archived: boolean | null }
type ChatDeleteRequest = { conversation_id: string }
type ChatDraftRequest = { conversation_id: string; draft: string }
type ChatAttachmentImportRequest = { conversation_id: string; message_id: string | null; paths: string[] }
export type ChatSendRequest = { conversation_id: string; branch_id: string; text: string; attachment_ids: string[]; provider_account_id: string; model: string; reasoning_effort: ChatReasoningEffort }
type ChatTurnRequest = { conversation_id: string; turn_id: string; model: string | null; reasoning_effort: ChatReasoningEffort | null }
type ChatEditRequest = { conversation_id: string; message_id: string; text: string; provider_account_id: string; model: string; reasoning_effort: ChatReasoningEffort }
type ChatBranchRequest = { conversation_id: string; message_id: string }
type ChatDeleteAttachmentRequest = { conversation_id: string; message_id: string; attachment_id: string }
type ChatExportRequest = { conversation_id: string; branch_id: string; destination: string }
type CodeWorkspaceOpenRequest = { path: string }
type CodeWorkspaceTrustRequest = { workspace_id: string; grant: boolean }
type CodeFileTreeQuery = { workspace_id: string; relative_path: string | null }
type CodeReadFileRequest = { workspace_id: string; relative_path: string }
type CodeSaveFileRequest = { workspace_id: string; relative_path: string; content: string; expected_fingerprint: string | null }
type CodeSaveLayoutRequest = { workspace_id: string; layout: CodePaneLayout }
type CodeGitStatusRequest = { workspace_id: string }
type CodeGitDiffRequest = { workspace_id: string; relative_path: string | null }
type CodeTerminalStartRequest = { workspace_id: string; kind: CodeTerminalKind; cols: number; rows: number; adapter_id: string | null; model: string | null; resume_session_id: string | null }
type CodeTerminalInputRequest = { terminal_id: string; data_base64: string }
type CodeTerminalInput = { terminal_id: string; data: string }
type CodeTerminalResizeRequest = { terminal_id: string; cols: number; rows: number }
type CodeTerminalStopRequest = { terminal_id: string; force: boolean }
type CodePreviewRequest = { workspace_id: string; url: string }
export type CodeRunCreateRequest = { workspace_id: string; title: string; objective: string; review_policy: CodeReviewPolicy; concurrency_limit: number | null; model: string | null; coordinator_id?: string | null; adapter_id?: string | null }
export type CodeDispatchResumeRequest = { run_id: string; task_id: string; dispatch_id: string; lease_generation: number }
export type CodeDispatchCancelRequest = { run_id: string; task_id: string; dispatch_id: string; lease_generation: number }
export type CodeDispatchTerminalRequest = { run_id: string; dispatch_id: string; cols: number; rows: number }
export type CodeRunUpdateRequest = { run_id: string; title: string; objective: string; review_policy: CodeReviewPolicy; concurrency_limit: number | null }
export type CodeTaskCreateRequest = { run_id: string; client_id: string | null; title: string; specification: string; depends_on: string[] }
export type CodeTaskUpdateRequest = { run_id: string; task_id: string; title: string; specification: string; depends_on: string[] }
export type CodeTaskDeleteRequest = { run_id: string; task_id: string }
export type CodeDagProposalRequest = { workspace_id: string; objective: string; model: string | null }
export type CodeDagProposalAcceptRequest = { run_id: string; proposal: CodeDagProposal }
export type CodeRunRequest = { run_id: string }
export type CodeQuestionAnswerRequest = { run_id: string; task_id: string; dispatch_id: string; lease_generation: number; answer: string }
export type CodeTaskRetryRequest = { run_id: string; task_id: string; reason: string | null }
export type CodeReviewRequest = { run_id: string; task_id: string; checkpoint_id: string; decision: CodeReviewDecision; feedback: string | null }
export type CodeCleanupPreviewRequest = { run_id: string; worktree_id: string }
export type CodeCleanupPreview = { worktree_id: string; path: string; branch: string; dirty_files: string[]; locked: boolean; can_remove: boolean; reason: string | null }
export type CodeCleanupConfirmRequest = { run_id: string; worktree_id: string; confirmation: string; force: boolean }
export type CodeOrchestrationEventsQuery = { run_id: string; after_sequence: number; limit: number | null }
export type CodeCheckpointDiffRequest = { run_id: string; checkpoint_id: string; compare_to_checkpoint_id: string | null }

const protocol: ProtocolVersion = { major: 2, minor: 0, patch: 0 }
const agenticSuperAppIsTauri = '__TAURI_INTERNALS__' in window
const previewProvider: ProviderAccountSummary = { id: 'agentic-super-app-openai', display_name: 'OpenAI Responses', default_model: 'gpt-5.6-mini', secret_configured: false, enabled: true }

function encodeTerminalInput(data: string): string {
  const bytes = new TextEncoder().encode(data)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}
const previewConversations = new Map<string, ChatConversationDetail>()
const previewSubscribers = new Set<(event: ChatEventEnvelope) => void>()
const previewCodeWorkspaces = new Map<string, { detail: CodeWorkspaceDetail; files: Map<string, CodeDocument> }>()
const previewCodeRuns = new Map<string, CodeRunDetail>()
const previewCodeSubscribers = new Set<(event: CodeOrchestrationEventEnvelope) => void>()
const previewAgentSubscribers = new Set<(event: AgentEventEnvelope) => void>()
const previewAgentSummary: AgentSummary = { id: 'local-operator', name: 'Local operator', description: 'A focused assistant for your explicitly granted folders.', avatar_color: '#22d3ee', provider_account_id: previewProvider.id, model: previewProvider.default_model ?? 'gpt-5.6-mini', version: 1, archived: false, active_run_state: null, enabled_skill_count: 1, enabled_tool_count: 8, folder_grant_count: 0, created_at_unix_ms: Date.now(), updated_at_unix_ms: Date.now() }
const previewAgentRuns = new Map<string, AgentRunDetail>()
const previewAgentSkills: AgentSkillSummary[] = [{ id: 'folder-brief', name: 'Folder brief', version: '1.0.0', description: 'Summarize an explicitly granted folder without changing it.', origin: 'builtin', source_path: 'builtin/folder-brief/SKILL.md', triggers: ['brief', 'summarize folder'], permissions: ['folder.list', 'folder.read_text'], enabled: true, valid: true, validation_message: null }, { id: 'decision-log', name: 'Decision log', version: '1.0.0', description: 'Capture an explicit decision in durable Agent memory.', origin: 'builtin', source_path: 'builtin/decision-log/SKILL.md', triggers: ['decision'], permissions: ['memory.remember'], enabled: false, valid: true, validation_message: null }]
const previewAgentTools: AgentToolDefinition[] = [{ name: 'folder.list', description: 'List entries in an explicitly granted folder.', input_schema_json: '{}', risk: 'read_only' }, { name: 'folder.read_text', description: 'Read a UTF-8 file in an explicitly granted folder.', input_schema_json: '{}', risk: 'read_only' }, { name: 'folder.write_text', description: 'Write a UTF-8 file in an explicitly writable folder.', input_schema_json: '{}', risk: 'filesystem_mutation' }, { name: 'memory.search', description: 'Search inspectable durable memory.', input_schema_json: '{}', risk: 'read_only' }, { name: 'memory.remember', description: 'Store an explicit non-sensitive memory.', input_schema_json: '{}', risk: 'internal_mutation' }, { name: 'artifact.create_text', description: 'Create a private text artifact.', input_schema_json: '{}', risk: 'internal_mutation' }, { name: 'user.request_input', description: 'Pause and ask the user for missing information.', input_schema_json: '{}', risk: 'read_only' }, { name: 'delegate_task', description: 'Start a bounded child run with inherited permissions.', input_schema_json: '{}', risk: 'externally_visible' }]
const previewRoutineExecution: RoutineExecution = { id: 'preview-execution-1', routine_id: 'preview-routine-1', run_id: null, occurrence_key: 'preview@UTC', scheduled_for_unix_ms: Date.now() - 86_400_000, state: 'completed', folder_grant_ids: [], plugin_tool_names: [], error: null, report: 'Completed with a local preview result.', created_at_unix_ms: Date.now() - 86_400_000, updated_at_unix_ms: Date.now() - 86_400_000, started_at_unix_ms: Date.now() - 86_400_000, completed_at_unix_ms: Date.now() - 86_400_000 }
const previewRoutines: RoutineDetail[] = [{ summary: { id: 'preview-routine-1', name: 'Morning brief', description: 'A bounded weekday briefing for the local operator.', agent_id: previewAgentSummary.id, agent_name: previewAgentSummary.name, schedule: { expression: '0 9 * * 1-5', timezone: 'Asia/Kolkata' }, enabled: true, archived: false, catch_up: 'run_latest', concurrency: 'skip', delivery: 'in_app_and_native', next_run_unix_ms: Date.now() + 3_600_000, last_run_unix_ms: Date.now() - 86_400_000, last_execution_state: 'completed', created_at_unix_ms: Date.now() - 172_800_000, updated_at_unix_ms: Date.now() - 86_400_000 }, prompt_template: 'Summarize the most important updates for me in five bullets.', folder_grant_ids: [], plugin_tool_names: [], max_duration_seconds: 600, max_tool_calls: 12, approval_timeout_seconds: 300, executions: [previewRoutineExecution] }]
const previewPluginCatalog: PluginCatalogEntry[] = [{ manifest: { id: 'web-json-reader', publisher: 'Agentic Super App', version: '1.0.0', name: 'Web JSON Reader', description: 'Read bounded JSON from an explicitly allow-listed HTTPS API.', adapter: 'json_http_get', tools: [{ name: 'get_json', description: 'Fetch a JSON document from the configured origin.', input_schema_json: '{"type":"object","properties":{"path":{"type":"string"},"query":{"type":"string"}},"required":["path"],"additionalProperties":false}', output_schema_json: '{"type":"object"}', risk: 'read_only' }], permissions: [{ capability: 'network.read', explanation: 'Reads JSON only from manifest-approved HTTPS hosts.' }], allowed_hosts: ['api.github.com', 'jsonplaceholder.typicode.com'], connection_kind: 'none', supports_dry_run: false, content_hash: 'preview-hash-reader' }, installed: true, enabled: true, connection_count: 1, assigned_agent_count: 1 }, { manifest: { id: 'webhook-delivery', publisher: 'Agentic Super App', version: '1.0.0', name: 'Webhook Delivery', description: 'Deliver JSON to a configured HTTPS webhook after approval.', adapter: 'json_http_post', tools: [{ name: 'post_json', description: 'Send a JSON payload to the configured webhook path.', input_schema_json: '{"type":"object","properties":{"path":{"type":"string"},"body":{"type":"object"}},"required":["path","body"],"additionalProperties":false}', output_schema_json: '{"type":"object"}', risk: 'externally_visible' }], permissions: [{ capability: 'network.write', explanation: 'Sends JSON to a configured HTTPS webhook.' }], allowed_hosts: ['hooks.example.com', 'webhook.site'], connection_kind: 'api_key_header', supports_dry_run: true, content_hash: 'preview-hash-webhook' }, installed: true, enabled: false, connection_count: 0, assigned_agent_count: 0 }]
const previewPluginConnections: PluginConnectionSummary[] = [{ id: 'preview-connection-reader', plugin_id: 'web-json-reader', name: 'GitHub API', origin: 'https://api.github.com', kind: 'none', api_key_header: null, secret_configured: false, validated_at_unix_ms: Date.now() - 86_400_000, created_at_unix_ms: Date.now() - 172_800_000, updated_at_unix_ms: Date.now() - 86_400_000 }]
const previewAgentGrants: AgentPluginGrant[] = [{ agent_id: previewAgentSummary.id, plugin_id: 'web-json-reader', connection_id: 'preview-connection-reader', tool_names: ['get_json'], enabled: true }]

function requestId() { return globalThis.crypto?.randomUUID?.() ?? `request-${Date.now()}-${Math.random().toString(16).slice(2)}` }
function previewId(prefix: string) { return `${prefix}-${requestId()}` }
function previewNow() { return Date.now() }
function envelope<T>(payload: T): CommandEnvelope<T> { return { protocol, request_id: requestId(), payload } }
function unwrap<T>(value: ResponseEnvelope<T>) { return value.payload }
function previewDetail(title = 'New chat'): ChatConversationDetail {
  const id = previewId('conversation')
  const branchId = previewId('branch')
  const now = previewNow()
  return { id, title, active_branch_id: branchId, pinned: false, archived: false, branches: [{ id: branchId, parent_branch_id: null, forked_after_message_id: null, label: 'Main', created_at_unix_ms: now, active: true }], messages: [], turns: [], draft: '', event_cursor: 0, created_at_unix_ms: now, updated_at_unix_ms: now }
}
function previewSummary(detail: ChatConversationDetail): ChatConversationSummary {
  const text = detail.messages.flatMap((message) => message.parts).find((part): part is Extract<ChatMessagePart, { kind: 'text' }> => part.kind === 'text')?.text ?? null
  return { id: detail.id, title: detail.title, active_branch_id: detail.active_branch_id, pinned: detail.pinned, archived: detail.archived, updated_at_unix_ms: detail.updated_at_unix_ms, preview: text?.slice(0, 160) ?? null }
}
function previewEvent(detail: ChatConversationDetail, kind: string, messageId: string | null, textDelta: string | null, message: string | null): ChatEventEnvelope {
  detail.event_cursor += 1
  const event = { global_sequence: detail.event_cursor, aggregate_sequence: detail.event_cursor, conversation_id: detail.id, branch_id: detail.active_branch_id, turn_id: null, message_id: messageId, kind, text_delta: textDelta, message, emitted_at_unix_ms: previewNow() }
  previewSubscribers.forEach((subscriber) => subscriber(event))
  return event
}
function previewResponse<T>(payload: T): Promise<T> { return Promise.resolve(payload) }
function previewCodeLayout(workspaceId: string): CodePaneLayout {
  return {
    workspace_id: workspaceId,
    version: 2,
    root_id: 'root',
    nodes: [
      { pane_id: 'root', parent_id: null, kind: 'empty', orientation: null, ratio_percent: null, children: [], resource_id: null, title: null },
    ],
    revision: 0,
    focused_pane_id: 'root',
    maximized_pane_id: null,
  }
}

function previewFindPane(layout: CodePaneLayout, paneId: string): CodePaneNode {
  const pane = layout.nodes.find((node) => node.pane_id === paneId)
  if (!pane) throw new Error(`Pane ${paneId} was not found.`)
  return pane
}

function previewCommitLayout(
  workspace: { detail: CodeWorkspaceDetail },
  mutate: (layout: CodePaneLayout) => void,
): CodePaneLayout {
  const layout = structuredClone(workspace.detail.layout)
  mutate(layout)
  layout.revision = (layout.revision ?? 0) + 1
  workspace.detail.layout = layout
  return structuredClone(layout)
}

function previewBindPane(
  layout: CodePaneLayout,
  paneId: string,
  kind: CodePaneKind,
  resourceId: string,
  title: string,
) {
  const pane = previewFindPane(layout, paneId)
  if (pane.children.length) throw new Error('Only leaf panes can hold a resource.')
  pane.kind = kind
  pane.resource_id = resourceId
  pane.title = title
  layout.focused_pane_id = paneId
  layout.maximized_pane_id = null
}

function previewSplitPane(layout: CodePaneLayout, paneId: string, placement: CodePanePlacement) {
  const target = previewFindPane(layout, paneId)
  if (target.children.length) throw new Error('Only leaf panes can be split.')
  const parentId = target.parent_id
  const splitId = previewId('split')
  const newPaneId = previewId('pane')
  const orientation: CodePaneOrientation = placement === 'top' || placement === 'bottom' ? 'vertical' : 'horizontal'
  const children = placement === 'left' || placement === 'top' ? [newPaneId, paneId] : [paneId, newPaneId]

  target.parent_id = splitId
  if (parentId) {
    const parent = previewFindPane(layout, parentId)
    parent.children = parent.children.map((child) => child === paneId ? splitId : child)
  } else {
    layout.root_id = splitId
  }
  layout.nodes.push(
    { pane_id: splitId, parent_id: parentId, kind: 'empty', orientation, ratio_percent: 50, children, resource_id: null, title: null },
    { pane_id: newPaneId, parent_id: splitId, kind: 'empty', orientation: null, ratio_percent: null, children: [], resource_id: null, title: null },
  )
  layout.focused_pane_id = newPaneId
  layout.maximized_pane_id = null
}

function previewDetachPane(layout: CodePaneLayout, paneId: string): CodePaneNode {
  const target = previewFindPane(layout, paneId)
  if (target.children.length) throw new Error('Only leaf panes can move.')
  const detached = structuredClone(target)
  const parentId = target.parent_id
  if (!parentId) {
    throw new Error('The root pane cannot be detached.')
  }
  const parent = previewFindPane(layout, parentId)
  const siblingId = parent.children.find((child) => child !== paneId)
  if (!siblingId) throw new Error('The pane split is missing its sibling.')
  const grandparentId = parent.parent_id
  const sibling = previewFindPane(layout, siblingId)
  sibling.parent_id = grandparentId
  if (grandparentId) {
    const grandparent = previewFindPane(layout, grandparentId)
    grandparent.children = grandparent.children.map((child) => child === parentId ? siblingId : child)
  } else {
    layout.root_id = siblingId
  }
  layout.nodes = layout.nodes.filter((node) => node.pane_id !== paneId && node.pane_id !== parentId)
  detached.parent_id = null
  return detached
}

function previewDockPane(layout: CodePaneLayout, detached: CodePaneNode, targetPaneId: string, placement: CodePanePlacement) {
  const target = previewFindPane(layout, targetPaneId)
  if (target.children.length) throw new Error('Only leaf panes can receive a moved pane.')
  const parentId = target.parent_id
  const splitId = previewId('split')
  const orientation: CodePaneOrientation = placement === 'top' || placement === 'bottom' ? 'vertical' : 'horizontal'
  const children = placement === 'left' || placement === 'top' ? [detached.pane_id, targetPaneId] : [targetPaneId, detached.pane_id]
  target.parent_id = splitId
  detached.parent_id = splitId
  if (parentId) {
    const parent = previewFindPane(layout, parentId)
    parent.children = parent.children.map((child) => child === targetPaneId ? splitId : child)
  } else {
    layout.root_id = splitId
  }
  layout.nodes.push({ pane_id: splitId, parent_id: parentId, kind: 'empty', orientation, ratio_percent: 50, children, resource_id: null, title: null }, detached)
  layout.focused_pane_id = detached.pane_id
  layout.maximized_pane_id = null
}

function previewReplaceWithEmpty(layout: CodePaneLayout) {
  const empty = previewCodeLayout(layout.workspace_id)
  Object.assign(layout, empty)
}
function previewCodeWorkspace(path: string): { detail: CodeWorkspaceDetail; files: Map<string, CodeDocument> } {
  const id = previewId('workspace')
  const now = previewNow()
  const files = new Map<string, CodeDocument>()
  const seed = (relativePath: string, content: string, language: string) => files.set(relativePath, { workspace_id: id, relative_path: relativePath, content, language, fingerprint: `preview-${relativePath}`, bytes: content.length, read_only: false, binary: false })
  seed('README.md', '# Agentic Super App\n\nThis is the Phase 4 browser preview workspace.\n', 'markdown')
  seed('src/main.tsx', "export function main() {\n  return 'Code mode is ready'\n}\n", 'typescript')
  const summary: CodeWorkspaceSummary = { id, host_id: 'browser-preview', display_name: path.split(/[\\/]/).filter(Boolean).pop() || 'Preview workspace', root_path: path || '~/agentic-demo', repository_name: 'agentic-demo', branch: 'main', is_git_repository: true, trust: 'untrusted', capabilities: ['read_files'], updated_at_unix_ms: now }
  const detail: CodeWorkspaceDetail = { summary, layout: previewCodeLayout(id), open_documents: [], terminals: [], previews: [] }
  const value = { detail, files }
  previewCodeWorkspaces.set(id, value)
  return value
}
function previewCodeDetail(workspaceId: string): CodeWorkspaceDetail {
  const workspace = previewCodeWorkspaces.get(workspaceId)
  if (!workspace) throw new Error('Workspace was not found.')
  return structuredClone(workspace.detail)
}
function previewCodeTree(workspaceId: string, relativeDirectory: string | null): CodeFileTree {
  const workspace = previewCodeWorkspaces.get(workspaceId)
  if (!workspace) throw new Error('Workspace was not found.')
  const directory = (relativeDirectory ?? '').replaceAll('\\', '/').replace(/^\/+|\/+$/g, '')
  const prefix = directory ? `${directory}/` : ''
  const entries = new Map<string, CodeFileNode>()
  workspace.files.forEach((file) => {
    if (!file.relative_path.startsWith(prefix)) return
    const remainder = file.relative_path.slice(prefix.length)
    const [name, ...rest] = remainder.split('/')
    if (!name) return
    if (rest.length) entries.set(name, { name, relative_path: `${prefix}${name}`, kind: 'directory', size: null, language: null, modified_at_unix_ms: null })
    else entries.set(name, { name, relative_path: file.relative_path, kind: 'file', size: file.bytes, language: file.language, modified_at_unix_ms: null })
  })
  return { workspace_id: workspaceId, directory, entries: [...entries.values()].sort((a, b) => (a.kind === 'directory' ? -1 : 1) - (b.kind === 'directory' ? -1 : 1) || a.name.localeCompare(b.name)), truncated: false }
}
function previewCodeSummary(): CodeSnapshot {
  return {
    workspaces: [...previewCodeWorkspaces.values()].map((item) => item.detail.summary),
    active_workspace_id: [...previewCodeWorkspaces.keys()][0] ?? null,
    adapters: [
      { id: CODEX_ADAPTER_ID, display_name: 'Codex CLI', executable: 'codex', detected: false, authenticated: false, capabilities: ['resume', 'model_selection', 'reasoning_effort', 'permission_modes'] },
      { id: CLAUDE_CODE_ADAPTER_ID, display_name: 'Claude Code', executable: 'claude', detected: false, authenticated: false, capabilities: ['resume', 'model_selection', 'permission_modes'] },
      { id: ANTIGRAVITY_ADAPTER_ID, display_name: 'Antigravity', executable: 'agy', detected: false, authenticated: false, capabilities: ['model_selection', 'permission_modes'] },
      { id: OPENCODE_ADAPTER_ID, display_name: 'OpenCode', executable: 'opencode', detected: false, authenticated: false, capabilities: ['resume', 'model_selection', 'permission_modes'] },
    ],
  }
}
function previewCodeRunDetail(runId: string): CodeRunDetail {
  const detail = previewCodeRuns.get(runId)
  if (!detail) throw new Error('Run was not found.')
  return structuredClone(detail)
}
function previewCodeRunEvent(detail: CodeRunDetail, payload: string, taskId: string | null = null, dispatchId: string | null = null, kind: CodeOrchestrationMessageKind = 'status', accepted = true) {
  detail.event_cursor += 1
  const event: CodeOrchestrationEventEnvelope = { run_id: detail.summary.id, sequence: detail.event_cursor, event_id: previewId('event'), task_id: taskId, dispatch_id: dispatchId, lease_generation: 0, kind, payload, accepted, origin: 'host', worker_sequence: null, nonce: null, emitted_at_unix_ms: previewNow() }
  detail.events.push(event)
  detail.messages.unshift({ id: previewId('message'), run_id: detail.summary.id, task_id: taskId, dispatch_id: dispatchId, kind, question_id: null, payload, created_at_unix_ms: previewNow() })
  previewCodeSubscribers.forEach((subscriber) => subscriber(event))
}
function previewCodeRunSummary(workspaceId: string, title: string, objective: string): CodeRunSummary {
  const now = previewNow()
  return { id: previewId('run'), workspace_id: workspaceId, title, objective, model: null, coordinator_id: 'browser-preview', adapter_id: CODEX_ADAPTER_ID, state: 'draft', review_policy: 'manual', concurrency_limit: 2, host_concurrency_cap: 4, task_count: 0, completed_tasks: 0, active_dispatches: 0, created_at_unix_ms: now, updated_at_unix_ms: now, error: null }
}
function previewRecountRun(detail: CodeRunDetail) {
  detail.summary.task_count = detail.tasks.length
  detail.summary.completed_tasks = detail.tasks.filter((task) => task.state === 'completed').length
  detail.summary.active_dispatches = detail.dispatches.filter((dispatch) => ['preparing', 'running', 'awaiting_input', 'checkpointing'].includes(dispatch.state)).length
  detail.summary.updated_at_unix_ms = previewNow()
}
function previewAdvanceRun(runId: string) {
  const detail = previewCodeRuns.get(runId)
  if (!detail || detail.summary.state !== 'running') return
  const task = detail.tasks.find((candidate) => candidate.state === 'ready')
  if (!task) {
    if (detail.tasks.every((candidate) => candidate.state === 'completed')) detail.summary.state = 'completed'
    previewRecountRun(detail)
    return
  }
  task.state = 'running'
  const dispatch: CodeDispatch = { id: previewId('dispatch'), run_id: runId, task_id: task.id, attempt: task.attempt + 1, state: 'running', adapter_id: CODEX_ADAPTER_ID, lease_generation: 1, session_id: null, pid: null, worktree_id: null, checkpoint_id: null, last_heartbeat_at_unix_ms: previewNow(), terminal_id: null, cancel_requested_at_unix_ms: null, started_at_unix_ms: previewNow(), updated_at_unix_ms: previewNow(), error: null, result_summary: null }
  detail.dispatches.unshift(dispatch)
  detail.summary.active_dispatches += 1
  previewCodeRunEvent(detail, `Worker lane started: ${task.title}`, task.id, dispatch.id, 'progress')
  setTimeout(() => {
    const current = previewCodeRuns.get(runId)
    const currentTask = current?.tasks.find((candidate) => candidate.id === task.id)
    const currentDispatch = current?.dispatches.find((candidate) => candidate.id === dispatch.id)
    if (!current || !currentTask || !currentDispatch || current.summary.state !== 'running') return
    currentTask.state = current.summary.review_policy === 'manual' ? 'awaiting_review' : 'completed'
    currentDispatch.state = 'succeeded'
    currentDispatch.result_summary = 'Preview worker completed with a reviewable checkpoint.'
    currentDispatch.updated_at_unix_ms = previewNow()
    currentTask.latest_checkpoint_id = previewId('checkpoint')
    if (current.summary.review_policy === 'manual') current.summary.state = 'blocked'
    previewRecountRun(current)
    previewCodeRunEvent(current, current.summary.review_policy === 'manual' ? 'Checkpoint ready for review' : 'Worker completed', currentTask.id, currentDispatch.id, 'completion')
    if (current.summary.review_policy === 'automatic') setTimeout(() => previewAdvanceRun(runId), 250)
  }, 650)
  previewRecountRun(detail)
}

function previewAgentDetail(): AgentDetail {
  return { summary: structuredClone(previewAgentSummary), operating_brief: 'Work only inside folders the user explicitly grants. Explain planned mutations before they happen.', system_instructions: 'You are a careful local-first assistant. Keep actions inspectable and ask before mutations.', approval_policy: 'ask_for_mutations', memory_policy: 'explicit_only', runtime_limits: { max_steps: 24, max_tool_calls: 32, max_duration_seconds: 1800, max_context_tokens: 128000, max_subagent_depth: 2, max_concurrent_subagents: 2 }, folders: [], tools: structuredClone(previewAgentTools), skills: structuredClone(previewAgentSkills), conflicts: [], recent_runs: [...previewAgentRuns.values()].map((run) => run.summary).slice(0, 12) }
}
function previewRoutineSummary(detail: RoutineDetail): RoutineSummary { return structuredClone(detail.summary) }
function previewCreateExecution(routine: RoutineDetail): RoutineExecution {
  const now = previewNow()
  return { id: previewId('routine-execution'), routine_id: routine.summary.id, run_id: null, occurrence_key: `manual:${now}`, scheduled_for_unix_ms: now, state: 'completed', folder_grant_ids: structuredClone(routine.folder_grant_ids), plugin_tool_names: structuredClone(routine.plugin_tool_names), error: null, report: 'Preview execution completed. The desktop host launches a durable Agent run here.', created_at_unix_ms: now, updated_at_unix_ms: now, started_at_unix_ms: now, completed_at_unix_ms: now }
}
function previewAgentDashboard(): AgentDashboard {
  return { agents: [structuredClone(previewAgentSummary)], active_runs: [...previewAgentRuns.values()].map((run) => run.summary).filter((run) => ['queued', 'preparing', 'running', 'awaiting_approval', 'awaiting_input', 'interrupted'].includes(run.state)), pending_approvals: [], recent_runs: [...previewAgentRuns.values()].map((run) => run.summary).slice(0, 20) }
}
function previewAgentRun(request: AgentRunStartRequest): AgentRunSummary {
  const id = previewId('agent-run')
  const now = previewNow()
  const conversationId = request.conversation_id ?? previewId('agent-conversation')
  const summary: AgentRunSummary = { id, agent_id: request.agent_id, agent_version: 1, conversation_id: conversationId, state: 'running', prompt_preview: request.prompt.slice(0, 160), background: request.background, step_count: 1, tool_call_count: 0, pending_approval_id: null, lease_generation: 1, input_tokens: null, output_tokens: null, error: null, created_at_unix_ms: now, updated_at_unix_ms: now, completed_at_unix_ms: null }
  const detail: AgentRunDetail = { summary, messages: [{ id: previewId('message'), run_id: id, role: 'user', kind: 'prompt', content: request.prompt, tool_call_id: null, created_at_unix_ms: now }], tool_calls: [], approvals: [], skills: structuredClone(previewAgentSkills.filter((skill) => skill.enabled)), memories: [], artifacts: [], child_runs: [], event_cursor: 0 }
  previewAgentRuns.set(id, detail)
  setTimeout(() => {
    const current = previewAgentRuns.get(id)
    if (!current || current.summary.state !== 'running') return
    const text = 'Preview run complete. In the desktop host, this turn is backed by the durable Agent runtime and explicit tool approvals.'
    current.summary.state = 'completed'; current.summary.completed_at_unix_ms = previewNow(); current.summary.updated_at_unix_ms = previewNow(); current.messages.push({ id: previewId('message'), run_id: id, role: 'assistant', kind: 'text', content: text, tool_call_id: null, created_at_unix_ms: previewNow() }); current.event_cursor += 1
    const event: AgentEventEnvelope = { run_id: id, sequence: current.event_cursor, event_id: previewId('event'), kind: 'assistant_text_delta', step: 1, tool_call_id: null, payload: JSON.stringify({ text }), emitted_at_unix_ms: previewNow() }
    previewAgentSubscribers.forEach((subscriber) => subscriber(event))
    previewAgentSummary.active_run_state = null; previewAgentSummary.updated_at_unix_ms = previewNow()
  }, 420)
  previewAgentSummary.active_run_state = 'running'; previewAgentSummary.updated_at_unix_ms = now
  return structuredClone(summary)
}

async function tauriCommand<TPayload, TResponse>(name: string, payload: TPayload): Promise<TResponse> {
  const result = await invoke<ResponseEnvelope<TResponse>>(name, { command: envelope(payload) })
  return unwrap(result)
}
async function tauriQuery<T>(name: string, args?: Record<string, unknown>): Promise<T> { return invoke<T>(name, args) }

export const agenticSuperAppClient = {
  async bootstrap(): Promise<BootstrapSnapshot> { return agenticSuperAppIsTauri ? tauriQuery<BootstrapSnapshot>('agentic_super_app_query_bootstrap') : { protocol, active_mode: 'agent', product_name: 'Agentic Super App' } },
  async setActiveMode(mode: ApplicationMode): Promise<BootstrapSnapshot> { return agenticSuperAppIsTauri ? invoke<BootstrapSnapshot>('agentic_super_app_command_set_active_mode', { command: { mode } }) : { protocol, active_mode: mode, product_name: 'Agentic Super App' } },
  async buildInformation(): Promise<BuildInformation> { return agenticSuperAppIsTauri ? tauriQuery<BuildInformation>('agentic_super_app_query_build_information') : { product_name: 'Agentic Super App', version: '1.0.0', protocol: { major: 2 } } },
  async diagnostics(): Promise<DiagnosticSnapshot> { return agenticSuperAppIsTauri ? tauriQuery<DiagnosticSnapshot>('agentic_super_app_query_diagnostic_snapshot') : { providers: [previewProvider], recent_jobs: [], notifications: [], recovery_message: null } },
  async checkForUpdate(): Promise<UpdateSnapshot> { return agenticSuperAppIsTauri ? tauriQuery<UpdateSnapshot>('agentic_super_app_query_update') : { configured: false, current_version: '1.0.0', available_version: null, notes: null, published_at: null, status: 'not_configured' } },
  async installUpdate(): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_install_update') },
  async createBackup(destination: string): Promise<BackupSummary> { return agenticSuperAppIsTauri ? invoke<BackupSummary>('agentic_super_app_command_create_backup', { destination }) : { path: destination, bytes: 0, created_at_unix_ms: Date.now(), includes_database: true, artifact_count: 0 } },
  async prepareRestore(source: string): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_prepare_restore', { source }) },
  async configureModel(model: string): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_configure_openai_provider', { model }) },
  async setSecret(secret: string): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_set_openai_secret', { secret }) },
  async validateProvider(): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_validate_openai_provider') },
  async startDiagnostic(request: { providerAccountId: string; model: string; prompt: string }): Promise<string> { return agenticSuperAppIsTauri ? invoke('agentic_super_app_command_start_provider_diagnostic', { request: { provider_account_id: request.providerAccountId, model: request.model, prompt: request.prompt } }) : 'preview-job' },
  async cancelJob(jobId: string): Promise<boolean> { return agenticSuperAppIsTauri ? invoke('agentic_super_app_command_cancel_job', { jobId }) : true },
  subscribe(onEvent: (event: SharedEventEnvelope) => void): void { if (agenticSuperAppIsTauri) void invoke('agentic_super_app_stream_shared_events', { channel: new Channel<SharedEventEnvelope>(onEvent) }) },
  async testNotification(): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_send_test_notification') },
  async markNotificationRead(notificationId: string): Promise<boolean> { return agenticSuperAppIsTauri ? invoke<boolean>('agentic_super_app_command_mark_notification_read', { notificationId }) : true },
  async markAllNotificationsRead(): Promise<number> { return agenticSuperAppIsTauri ? invoke<number>('agentic_super_app_command_mark_all_notifications_read') : 0 },
  async restartRecovery(): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_prepare_restart_recovery') },

  async agentDashboard(): Promise<AgentDashboard> { return agenticSuperAppIsTauri ? tauriQuery<AgentDashboard>('agentic_super_app_query_agent_dashboard') : previewAgentDashboard() },
  async agents(): Promise<AgentSummary[]> { return agenticSuperAppIsTauri ? tauriQuery<AgentSummary[]>('agentic_super_app_query_agents') : [structuredClone(previewAgentSummary)] },
  async agent(agentId: string): Promise<AgentDetail> { return agenticSuperAppIsTauri ? tauriQuery<AgentDetail>('agentic_super_app_query_agent', { request: { agent_id: agentId } }) : previewAgentDetail() },
  async createAgent(request: AgentCreateRequest): Promise<AgentDetail> {
    if (agenticSuperAppIsTauri) return tauriQuery<AgentDetail>('agentic_super_app_command_create_agent', { request })
    Object.assign(previewAgentSummary, { name: request.name, description: request.description, model: request.model, avatar_color: request.avatar_color })
    return previewAgentDetail()
  },
  async updateAgent(request: AgentUpdateRequest): Promise<AgentDetail> { return agenticSuperAppIsTauri ? tauriQuery<AgentDetail>('agentic_super_app_command_update_agent', { request }) : previewAgentDetail() },
  async archiveAgent(agentId: string, archived: boolean): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_archive_agent', { request: { agent_id: agentId }, archived }) },
  async deleteAgent(agentId: string): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_delete_agent', { request: { agent_id: agentId } }) },
  async addAgentFolder(request: AgentFolderGrantRequest): Promise<AgentFolderGrant> { return tauriQuery<AgentFolderGrant>('agentic_super_app_command_add_agent_folder', { request }) },
  async deleteAgentFolder(request: AgentFolderGrantDeleteRequest): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_delete_agent_folder', { request }) },
  async agentSkills(): Promise<AgentSkillCatalog> { return agenticSuperAppIsTauri ? tauriQuery<AgentSkillCatalog>('agentic_super_app_query_agent_skills') : { skills: structuredClone(previewAgentSkills), conflicts: [] } },
  async toggleAgentSkill(request: AgentSkillToggleRequest): Promise<AgentDetail> {
    if (agenticSuperAppIsTauri) return tauriQuery<AgentDetail>('agentic_super_app_command_toggle_agent_skill', { request })
    const skill = previewAgentSkills.find((item) => item.id === request.skill_id); if (skill) skill.enabled = request.enabled; return previewAgentDetail()
  },
  async agentMemory(query: AgentMemoryQuery): Promise<AgentMemorySummary[]> { return agenticSuperAppIsTauri ? tauriQuery<AgentMemorySummary[]>('agentic_super_app_query_agent_memory', { query }) : [] },
  async rememberAgentMemory(request: AgentMemoryMutationRequest): Promise<AgentMemorySummary> { return tauriQuery<AgentMemorySummary>('agentic_super_app_command_remember_agent_memory', { request }) },
  async deleteAgentMemory(request: AgentMemoryDeleteRequest): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_delete_agent_memory', { request }) },
  async agentConversations(query: AgentConversationQuery): Promise<AgentConversationSummary[]> { return agenticSuperAppIsTauri ? tauriQuery<AgentConversationSummary[]>('agentic_super_app_query_agent_conversations', { query }) : [] },
  async createAgentConversation(request: AgentConversationCreateRequest): Promise<AgentConversationDetail> { return tauriQuery<AgentConversationDetail>('agentic_super_app_command_create_agent_conversation', { request }) },
  async agentConversation(conversationId: string): Promise<AgentConversationDetail> { return tauriQuery<AgentConversationDetail>('agentic_super_app_query_agent_conversation', { conversationId }) },
  async agentRuns(query: AgentRunsQuery): Promise<AgentRunSummary[]> { return agenticSuperAppIsTauri ? tauriQuery<AgentRunSummary[]>('agentic_super_app_query_agent_runs', { query }) : [...previewAgentRuns.values()].map((run) => run.summary) },
  async agentRun(runId: string): Promise<AgentRunDetail> { return agenticSuperAppIsTauri ? tauriQuery<AgentRunDetail>('agentic_super_app_query_agent_run', { runId }) : structuredClone(previewAgentRuns.get(runId) ?? (() => { throw new Error('Run was not found.') })()) },
  async startAgentRun(request: AgentRunStartRequest): Promise<AgentRunSummary> { return agenticSuperAppIsTauri ? tauriQuery<AgentRunSummary>('agentic_super_app_command_start_agent_run', { request }) : previewAgentRun(request) },
  async resumeAgentRun(request: AgentRunControlRequest): Promise<AgentRunSummary> { return agenticSuperAppIsTauri ? tauriQuery<AgentRunSummary>('agentic_super_app_command_resume_agent_run', { request }) : (previewAgentRuns.get(request.run_id)?.summary ?? (() => { throw new Error('Run was not found.') })()) },
  async cancelAgentRun(request: AgentRunControlRequest): Promise<AgentRunSummary> { return agenticSuperAppIsTauri ? tauriQuery<AgentRunSummary>('agentic_super_app_command_cancel_agent_run', { request }) : (previewAgentRuns.get(request.run_id)?.summary ?? (() => { throw new Error('Run was not found.') })()) },
  async decideAgentApproval(request: AgentApprovalDecisionRequest): Promise<AgentRunSummary> { return tauriQuery<AgentRunSummary>('agentic_super_app_command_decide_agent_approval', { request }) },
  async submitAgentInput(request: AgentInputRequest): Promise<AgentRunSummary> { return tauriQuery<AgentRunSummary>('agentic_super_app_command_submit_agent_input', { request }) },
  subscribeAgent(runId: string, onEvent: (event: AgentEventEnvelope) => void, afterSequence = 0): () => void {
    if (agenticSuperAppIsTauri) { const channel = new Channel<AgentEventEnvelope>(onEvent); void invoke('agentic_super_app_stream_agent_events', { query: { run_id: runId, after_sequence: afterSequence, limit: 500 }, channel }); return () => undefined }
    const subscriber = (event: AgentEventEnvelope) => { if (event.run_id === runId && event.sequence > afterSequence) onEvent(event) }; previewAgentSubscribers.add(subscriber); return () => previewAgentSubscribers.delete(subscriber)
  },
  async exportAgent(request: AgentExportRequest): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_export_agent', { request }) },

  async routines(query: RoutineQuery = { enabled: null, include_archived: false, limit: 100 }): Promise<RoutineSummary[]> {
    if (agenticSuperAppIsTauri) return tauriQuery<RoutineSummary[]>('agentic_super_app_query_routines', { query })
    return previewRoutines.map(previewRoutineSummary).filter((routine) => query.include_archived || !routine.archived).filter((routine) => query.enabled === null || routine.enabled === query.enabled)
  },
  async routine(routineId: string): Promise<RoutineDetail> {
    if (agenticSuperAppIsTauri) return tauriQuery<RoutineDetail>('agentic_super_app_query_routine', { request: { routine_id: routineId } })
    const routine = previewRoutines.find((item) => item.summary.id === routineId)
    if (!routine) throw new Error('Routine was not found.')
    return structuredClone(routine)
  },
  async createRoutine(request: RoutineCreateRequest): Promise<RoutineDetail> {
    if (agenticSuperAppIsTauri) return tauriQuery<RoutineDetail>('agentic_super_app_command_create_routine', { request })
    const now = previewNow()
    const detail: RoutineDetail = { summary: { id: previewId('routine'), name: request.name, description: request.description, agent_id: request.agent_id, agent_name: previewAgentSummary.name, schedule: structuredClone(request.schedule), enabled: request.enabled, archived: false, catch_up: request.catch_up, concurrency: request.concurrency, delivery: request.delivery, next_run_unix_ms: request.enabled ? now + 3_600_000 : null, last_run_unix_ms: null, last_execution_state: null, created_at_unix_ms: now, updated_at_unix_ms: now }, prompt_template: request.prompt_template, folder_grant_ids: structuredClone(request.folder_grant_ids), plugin_tool_names: structuredClone(request.plugin_tool_names), max_duration_seconds: request.max_duration_seconds, max_tool_calls: request.max_tool_calls, approval_timeout_seconds: request.approval_timeout_seconds, executions: [] }
    previewRoutines.unshift(detail)
    return structuredClone(detail)
  },
  async updateRoutine(request: RoutineUpdateRequest): Promise<RoutineDetail> {
    if (agenticSuperAppIsTauri) return tauriQuery<RoutineDetail>('agentic_super_app_command_update_routine', { request })
    const detail = previewRoutines.find((item) => item.summary.id === request.routine_id)
    if (!detail) throw new Error('Routine was not found.')
    Object.assign(detail.summary, { name: request.name, description: request.description, agent_id: request.agent_id, schedule: structuredClone(request.schedule), enabled: request.enabled, catch_up: request.catch_up, concurrency: request.concurrency, delivery: request.delivery, next_run_unix_ms: request.enabled ? previewNow() + 3_600_000 : null, updated_at_unix_ms: previewNow() })
    Object.assign(detail, { prompt_template: request.prompt_template, folder_grant_ids: structuredClone(request.folder_grant_ids), plugin_tool_names: structuredClone(request.plugin_tool_names), max_duration_seconds: request.max_duration_seconds, max_tool_calls: request.max_tool_calls, approval_timeout_seconds: request.approval_timeout_seconds })
    return structuredClone(detail)
  },
  async archiveRoutine(routineId: string): Promise<void> {
    if (agenticSuperAppIsTauri) { await invoke('agentic_super_app_command_archive_routine', { request: { routine_id: routineId } }); return }
    const detail = previewRoutines.find((item) => item.summary.id === routineId)
    if (detail) { detail.summary.archived = true; detail.summary.enabled = false }
  },
  async runRoutineNow(routineId: string): Promise<RoutineExecution> {
    if (agenticSuperAppIsTauri) return tauriQuery<RoutineExecution>('agentic_super_app_command_run_routine_now', { request: { routine_id: routineId } })
    const detail = previewRoutines.find((item) => item.summary.id === routineId)
    if (!detail) throw new Error('Routine was not found.')
    const execution = previewCreateExecution(detail)
    detail.executions.unshift(execution); detail.summary.last_run_unix_ms = execution.scheduled_for_unix_ms; detail.summary.last_execution_state = execution.state; detail.summary.updated_at_unix_ms = execution.updated_at_unix_ms
    return structuredClone(execution)
  },
  async routineExecutions(query: RoutineExecutionsQuery): Promise<RoutineExecution[]> {
    if (agenticSuperAppIsTauri) return tauriQuery<RoutineExecution[]>('agentic_super_app_query_routine_executions', { query })
    return structuredClone(previewRoutines.find((item) => item.summary.id === query.routine_id)?.executions.slice(0, query.limit ?? 50) ?? [])
  },
  async pluginCatalog(): Promise<PluginCatalogEntry[]> { return agenticSuperAppIsTauri ? tauriQuery<PluginCatalogEntry[]>('agentic_super_app_query_plugin_catalog') : structuredClone(previewPluginCatalog) },
  async pluginConnections(pluginId?: string): Promise<PluginConnectionSummary[]> { return agenticSuperAppIsTauri ? tauriQuery<PluginConnectionSummary[]>('agentic_super_app_query_plugin_connections', { pluginId: pluginId ?? null }) : structuredClone(previewPluginConnections.filter((item) => !pluginId || item.plugin_id === pluginId)) },
  async installPlugin(request: PluginInstallRequest): Promise<void> {
    if (agenticSuperAppIsTauri) { await invoke('agentic_super_app_command_install_plugin', { request }); return }
    const entry = previewPluginCatalog.find((item) => item.manifest.id === request.plugin_id); if (entry) { entry.installed = request.enabled; entry.enabled = request.enabled }
  },
  async createPluginConnection(request: PluginConnectionCreateRequest): Promise<PluginConnectionSummary> {
    if (agenticSuperAppIsTauri) return tauriQuery<PluginConnectionSummary>('agentic_super_app_command_create_plugin_connection', { request })
    const now = previewNow(); const connection: PluginConnectionSummary = { id: previewId('connection'), plugin_id: request.plugin_id, name: request.name, origin: request.origin, kind: request.kind, api_key_header: request.api_key_header, secret_configured: Boolean(request.secret_value), validated_at_unix_ms: null, created_at_unix_ms: now, updated_at_unix_ms: now }; previewPluginConnections.push(connection); return structuredClone(connection)
  },
  async updatePluginConnection(request: PluginConnectionUpdateRequest): Promise<PluginConnectionSummary> {
    if (agenticSuperAppIsTauri) return tauriQuery<PluginConnectionSummary>('agentic_super_app_command_update_plugin_connection', { request })
    const connection = previewPluginConnections.find((item) => item.id === request.connection_id); if (!connection) throw new Error('Plugin connection was not found.')
    Object.assign(connection, { name: request.name, origin: request.origin, api_key_header: request.api_key_header, secret_configured: request.secret_value ? true : connection.secret_configured, validated_at_unix_ms: null, updated_at_unix_ms: previewNow() }); return structuredClone(connection)
  },
  async deletePluginConnection(connectionId: string): Promise<void> { if (agenticSuperAppIsTauri) { await invoke('agentic_super_app_command_delete_plugin_connection', { request: { connection_id: connectionId } }); return } const index = previewPluginConnections.findIndex((item) => item.id === connectionId); if (index >= 0) previewPluginConnections.splice(index, 1) },
  async testPluginConnection(connectionId: string): Promise<PluginConnectionSummary> { if (agenticSuperAppIsTauri) return tauriQuery<PluginConnectionSummary>('agentic_super_app_command_test_plugin_connection', { request: { connection_id: connectionId } }); const connection = previewPluginConnections.find((item) => item.id === connectionId); if (!connection) throw new Error('Plugin connection was not found.'); connection.validated_at_unix_ms = previewNow(); return structuredClone(connection) },
  async agentPluginGrants(agentId: string): Promise<AgentPluginGrant[]> { return agenticSuperAppIsTauri ? tauriQuery<AgentPluginGrant[]>('agentic_super_app_query_agent_plugin_grants', { request: { agent_id: agentId } }) : structuredClone(previewAgentGrants.filter((grant) => grant.agent_id === agentId)) },
  async setAgentPluginGrant(request: AgentPluginGrantRequest): Promise<AgentPluginGrant> {
    if (agenticSuperAppIsTauri) return tauriQuery<AgentPluginGrant>('agentic_super_app_command_set_agent_plugin_grant', { request })
    const existing = previewAgentGrants.find((grant) => grant.agent_id === request.agent_id && grant.plugin_id === request.plugin_id && grant.connection_id === request.connection_id); if (existing) Object.assign(existing, request); else previewAgentGrants.push(structuredClone(request)); return structuredClone(request)
  },
  async dryRunPlugin(request: PluginDryRunRequest): Promise<string> { return agenticSuperAppIsTauri ? tauriQuery<string>('agentic_super_app_command_dry_run_plugin', { request }) : JSON.stringify({ dry_run: true, target: 'https://hooks.example.com' + JSON.parse(request.arguments_json).path, message: 'No network request was sent.' }) },
  async pluginInvocations(runId: string): Promise<PluginInvocationSummary[]> { return agenticSuperAppIsTauri ? tauriQuery<PluginInvocationSummary[]>('agentic_super_app_query_plugin_invocations', { runId }) : [] },

  async codeSnapshot(): Promise<CodeSnapshot> {
    return agenticSuperAppIsTauri ? tauriQuery<CodeSnapshot>('agentic_super_app_query_code_snapshot') : previewCodeSummary()
  },
  async codeWorkspace(workspaceId: string): Promise<CodeWorkspaceDetail> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeWorkspaceDetail>('agentic_super_app_query_code_workspace', { query: { workspace_id: workspaceId } })
    return previewCodeDetail(workspaceId)
  },
  async openCodeWorkspace(path: string): Promise<CodeWorkspaceDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeWorkspaceOpenRequest, CodeWorkspaceDetail>('agentic_super_app_command_open_code_workspace', { path })
    return previewCodeWorkspace(path).detail
  },
  async trustCodeWorkspace(workspaceId: string, grant: boolean): Promise<CodeWorkspaceDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeWorkspaceTrustRequest, CodeWorkspaceDetail>('agentic_super_app_command_trust_code_workspace', { workspace_id: workspaceId, grant })
    const workspace = previewCodeWorkspaces.get(workspaceId)
    if (!workspace) throw new Error('Workspace was not found.')
    workspace.detail.summary.trust = grant ? 'trusted' : 'untrusted'
    workspace.detail.summary.capabilities = grant ? ['read_files', 'write_files', 'execute_processes', 'read_git', 'open_preview'] : ['read_files']
    return previewCodeDetail(workspaceId)
  },
  async codeFileTree(request: CodeFileTreeQuery): Promise<CodeFileTree> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeFileTree>('agentic_super_app_query_code_file_tree', { query: request })
    return previewCodeTree(request.workspace_id, request.relative_path)
  },
  async readCodeFile(request: CodeReadFileRequest): Promise<CodeDocument> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeDocument>('agentic_super_app_query_code_file', { request })
    const file = previewCodeWorkspaces.get(request.workspace_id)?.files.get(request.relative_path)
    if (!file) throw new Error('File was not found.')
    return structuredClone(file)
  },
  async saveCodeFile(request: CodeSaveFileRequest): Promise<CodeDocument> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeSaveFileRequest, CodeDocument>('agentic_super_app_command_save_code_file', request)
    const workspace = previewCodeWorkspaces.get(request.workspace_id)
    const file = workspace?.files.get(request.relative_path)
    if (!workspace || !file) throw new Error('File was not found.')
    if (workspace.detail.summary.trust !== 'trusted') throw new Error('Trust this workspace before saving files.')
    if (request.expected_fingerprint && request.expected_fingerprint !== file.fingerprint) throw new Error('The file changed on disk. Reload it before saving.')
    file.content = request.content
    file.bytes = request.content.length
    file.fingerprint = `preview-${previewNow()}-${Math.random().toString(16).slice(2)}`
    return structuredClone(file)
  },
  async saveCodeLayout(request: CodeSaveLayoutRequest): Promise<CodePaneLayout> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeSaveLayoutRequest, CodePaneLayout>('agentic_super_app_command_save_code_layout', request)
    const workspace = previewCodeWorkspaces.get(request.workspace_id)
    if (!workspace) throw new Error('Workspace was not found.')
    workspace.detail.layout = structuredClone(request.layout)
    return structuredClone(request.layout)
  },
  async applyCodePaneMutation(request: CodePaneMutationRequest): Promise<CodePaneMutationResult> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodePaneMutationRequest, CodePaneMutationResult>('agentic_super_app_command_apply_code_pane_mutation', request)
    const workspace = previewCodeWorkspaces.get(request.workspace_id)
    if (!workspace) throw new Error('Workspace was not found.')
    if ((workspace.detail.layout.revision ?? 0) !== request.expected_revision) throw new Error('layout_conflict')
    const layout = previewCommitLayout(workspace, (next) => {
      switch (request.mutation.type) {
        case 'split':
          previewSplitPane(next, request.mutation.pane_id, request.mutation.placement)
          break
        case 'rename': {
          const pane = previewFindPane(next, request.mutation.pane_id)
          if (pane.children.length) throw new Error('Only leaf panes can be renamed.')
          const title = request.mutation.title.trim()
          if (!title || title.length > 80) throw new Error('Pane title must be between 1 and 80 characters.')
          pane.title = title
          break
        }
        case 'move': {
          const source = previewFindPane(next, request.mutation.pane_id)
          const target = previewFindPane(next, request.mutation.target_pane_id)
          if (source.children.length || target.children.length) throw new Error('Only leaf panes can move.')
          if (request.mutation.placement === 'center') {
            const sourceContent = { kind: source.kind, resource_id: source.resource_id, title: source.title }
            source.kind = target.kind
            source.resource_id = target.resource_id
            source.title = target.title
            target.kind = sourceContent.kind
            target.resource_id = sourceContent.resource_id
            target.title = sourceContent.title
            next.focused_pane_id = target.pane_id
          } else {
            const detached = previewDetachPane(next, source.pane_id)
            previewDockPane(next, detached, target.pane_id, request.mutation.placement)
          }
          break
        }
        case 'resize': {
          const split = previewFindPane(next, request.mutation.split_id)
          if (split.children.length !== 2) throw new Error('Only split panes can be resized.')
          split.ratio_percent = Math.max(10, Math.min(90, Math.round(request.mutation.ratio_percent)))
          break
        }
        case 'focus':
          previewFindPane(next, request.mutation.pane_id)
          next.focused_pane_id = request.mutation.pane_id
          break
        case 'maximize':
          if (request.mutation.pane_id) {
            const pane = previewFindPane(next, request.mutation.pane_id)
            if (pane.children.length) throw new Error('Only leaf panes can be maximized.')
          }
          next.maximized_pane_id = request.mutation.pane_id
          if (request.mutation.pane_id) next.focused_pane_id = request.mutation.pane_id
          break
        case 'apply_preset':
          // The preview keeps the existing tree but still records the action;
          // native hosts apply the full deterministic preset topology.
          next.maximized_pane_id = null
          if (request.mutation.primary_pane_id) {
            previewFindPane(next, request.mutation.primary_pane_id)
            next.focused_pane_id = request.mutation.primary_pane_id
          }
          break
      }
    })
    return { layout }
  },
  async launchCodePaneTerminal(request: LaunchCodePaneTerminalRequest, onEvent?: (event: CodeTerminalEvent) => void): Promise<LaunchCodePaneTerminalResult> {
    if (agenticSuperAppIsTauri) {
      const channel = new Channel<CodeTerminalEvent>(onEvent ?? (() => undefined))
      const result = await invoke<ResponseEnvelope<LaunchCodePaneTerminalResult>>('agentic_super_app_command_launch_code_pane_terminal', { command: envelope(request), channel })
      return unwrap(result)
    }
    const workspace = previewCodeWorkspaces.get(request.workspace_id)
    if (!workspace) throw new Error('Workspace was not found.')
    if (workspace.detail.summary.trust !== 'trusted') throw new Error('Trust this workspace before starting a terminal.')
    const id = previewId('terminal')
    const now = previewNow()
    const summary: CodeTerminalSummary = { id, workspace_id: request.workspace_id, kind: request.kind, state: 'running', pid: null, adapter_id: request.adapter_id, model: request.model, session_id: null, exit_code: null, started_at_unix_ms: now, updated_at_unix_ms: now }
    workspace.detail.terminals = [summary, ...workspace.detail.terminals.filter((item) => item.id !== id)]
    const layout = previewCommitLayout(workspace, (next) => previewBindPane(next, request.pane_id, request.kind === 'coding_agent' ? 'coding_agent' : 'terminal', id, request.kind === 'coding_agent' ? (request.adapter_id ?? 'Coding Agent') : 'Terminal'))
    onEvent?.({ terminal_id: id, sequence: 1, kind: 'started', data_base64: null, exit_code: null, message: null, emitted_at_unix_ms: now })
    onEvent?.({ terminal_id: id, sequence: 2, kind: 'output', data_base64: btoa('Preview terminal ready.\r\n'), exit_code: null, message: null, emitted_at_unix_ms: now })
    return { layout, terminal: summary }
  },
  async openCodePanePreview(request: OpenCodePanePreviewRequest): Promise<OpenCodePanePreviewResult> {
    if (agenticSuperAppIsTauri) return tauriCommand<OpenCodePanePreviewRequest, OpenCodePanePreviewResult>('agentic_super_app_command_open_code_pane_preview', request)
    const workspace = previewCodeWorkspaces.get(request.workspace_id)
    if (!workspace) throw new Error('Workspace was not found.')
    if (workspace.detail.summary.trust !== 'trusted') throw new Error('Trust this workspace before opening a preview.')
    const url = new URL(request.url)
    const preview: CodePreviewSummary = { id: previewId('preview'), workspace_id: request.workspace_id, url: url.toString(), origin: url.origin, state: 'open' }
    workspace.detail.previews = [preview, ...workspace.detail.previews]
    const layout = previewCommitLayout(workspace, (next) => previewBindPane(next, request.pane_id, 'preview', preview.id, 'Preview'))
    return { layout, preview }
  },
  async createCodePaneThread(request: CreateCodePaneThreadRequest): Promise<CreateCodePaneThreadResult> {
    if (agenticSuperAppIsTauri) return tauriCommand<CreateCodePaneThreadRequest, CreateCodePaneThreadResult>('agentic_super_app_command_create_code_pane_thread', request)
    const workspace = previewCodeWorkspaces.get(request.workspace_id)
    if (!workspace) throw new Error('Workspace was not found.')
    if (workspace.detail.summary.trust !== 'trusted') throw new Error('Trust this workspace before creating a thread.')
    const conversation = previewDetail('Workspace Thread')
    previewConversations.set(conversation.id, conversation)
    const layout = previewCommitLayout(workspace, (next) => previewBindPane(next, request.pane_id, 'thread', conversation.id, 'Thread'))
    return { layout, conversation }
  },
  async closeCodePane(request: CloseCodePaneRequest): Promise<CodePaneMutationResult> {
    if (agenticSuperAppIsTauri) return tauriCommand<CloseCodePaneRequest, CodePaneMutationResult>('agentic_super_app_command_close_code_pane', request)
    const workspace = previewCodeWorkspaces.get(request.workspace_id)
    if (!workspace) throw new Error('Workspace was not found.')
    const node = previewFindPane(workspace.detail.layout, request.pane_id)
    if (node.resource_id) {
      workspace.detail.terminals = workspace.detail.terminals.filter((terminal) => terminal.id !== node.resource_id)
      workspace.detail.previews = workspace.detail.previews.filter((preview) => preview.id !== node.resource_id)
    }
    const layout = previewCommitLayout(workspace, (next) => {
      const leaves = next.nodes.filter((item) => item.children.length === 0)
      if (leaves.length <= 1) previewReplaceWithEmpty(next)
      else previewDetachPane(next, request.pane_id)
    })
    return { layout }
  },
  async getCodeTerminalSnapshot(terminalId: string): Promise<CodeTerminalSnapshot> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeTerminalSnapshot>('agentic_super_app_query_code_terminal_snapshot', { query: { terminal_id: terminalId } })
    const previewTerminal = [...previewCodeWorkspaces.values()].flatMap((item) => item.detail.terminals).find((terminal) => terminal.id === terminalId)
    return {
      summary: previewTerminal ?? { id: terminalId, workspace_id: 'preview', kind: 'shell', state: 'running', pid: null, adapter_id: null, model: null, session_id: null, exit_code: null, started_at_unix_ms: previewNow(), updated_at_unix_ms: previewNow() },
      cols: 80,
      rows: 24,
      output_base64: btoa('Preview terminal snapshot\r\n'),
      sequence: 1,
    }
  },
  subscribeCodeTerminalEvents(terminalId: string, afterSequence: number, onEvent: (event: CodeTerminalEvent) => void): () => void {
    if (agenticSuperAppIsTauri) {
      const channel = new Channel<CodeTerminalEvent>(onEvent)
      void invoke('agentic_super_app_stream_code_terminal_events', { request: { terminal_id: terminalId, after_sequence: afterSequence }, channel }).catch(() => undefined)
      return () => undefined
    }
    return () => undefined
  },
  async codeGitStatus(request: CodeGitStatusRequest): Promise<CodeGitStatus> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeGitStatus>('agentic_super_app_query_code_git_status', { request })
    if (previewCodeWorkspaces.get(request.workspace_id)?.detail.summary.trust !== 'trusted') throw new Error('Trust this workspace before reading Git status.')
    return { workspace_id: request.workspace_id, branch: 'main', ahead: 0, behind: 0, files: [] }
  },
  async codeGitDiff(request: CodeGitDiffRequest): Promise<CodeGitDiff> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeGitDiff>('agentic_super_app_query_code_git_diff', { request })
    const workspace = previewCodeWorkspaces.get(request.workspace_id)
    if (!workspace) throw new Error('Workspace was not found.')
    if (workspace.detail.summary.trust !== 'trusted') throw new Error('Trust this workspace before reading Git diff.')
    const file = request.relative_path ? workspace.files.get(request.relative_path) : null
    return { workspace_id: request.workspace_id, relative_path: request.relative_path, content: file ? `diff --git a/${file.relative_path} b/${file.relative_path}\n--- a/${file.relative_path}\n+++ b/${file.relative_path}\n@@\n+${file.content}` : '', binary: false, truncated: false }
  },
  async startCodeTerminal(request: CodeTerminalStartRequest, onEvent: (event: CodeTerminalEvent) => void): Promise<CodeTerminalSummary> {
    if (agenticSuperAppIsTauri) {
      const channel = new Channel<CodeTerminalEvent>(onEvent)
      const result = await invoke<ResponseEnvelope<CodeTerminalSummary>>('agentic_super_app_command_start_code_terminal', { command: envelope(request), channel })
      return unwrap(result)
    }
    if (previewCodeWorkspaces.get(request.workspace_id)?.detail.summary.trust !== 'trusted') throw new Error('Trust this workspace before starting a terminal.')
    const id = previewId('terminal')
    const now = previewNow()
    const summary: CodeTerminalSummary = { id, workspace_id: request.workspace_id, kind: request.kind, state: 'running', pid: null, adapter_id: request.adapter_id, model: request.model, session_id: null, exit_code: null, started_at_unix_ms: now, updated_at_unix_ms: now }
    const workspace = previewCodeWorkspaces.get(request.workspace_id)
    if (workspace) workspace.detail.terminals = [summary, ...workspace.detail.terminals.filter((item) => item.id !== id)]
    onEvent({ terminal_id: id, sequence: 1, kind: 'started', data_base64: null, exit_code: null, message: null, emitted_at_unix_ms: now })
    setTimeout(() => onEvent({ terminal_id: id, sequence: 2, kind: 'output', data_base64: btoa('Preview terminal ready.\r\n'), exit_code: null, message: null, emitted_at_unix_ms: previewNow() }), 20)
    return summary
  },
  async writeCodeTerminal(request: CodeTerminalInput): Promise<boolean> {
    const payload: CodeTerminalInputRequest = { terminal_id: request.terminal_id, data_base64: encodeTerminalInput(request.data) }
    return agenticSuperAppIsTauri ? tauriCommand<CodeTerminalInputRequest, boolean>('agentic_super_app_command_write_code_terminal', payload) : true
  },
  async resizeCodeTerminal(request: CodeTerminalResizeRequest): Promise<boolean> { return agenticSuperAppIsTauri ? tauriCommand<CodeTerminalResizeRequest, boolean>('agentic_super_app_command_resize_code_terminal', request) : true },
  async stopCodeTerminal(request: CodeTerminalStopRequest): Promise<boolean> { return agenticSuperAppIsTauri ? tauriCommand<CodeTerminalStopRequest, boolean>('agentic_super_app_command_stop_code_terminal', request) : true },
  async openCodePreview(request: CodePreviewRequest): Promise<CodePreviewSummary> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodePreviewRequest, CodePreviewSummary>('agentic_super_app_command_open_code_preview', request)
    if (previewCodeWorkspaces.get(request.workspace_id)?.detail.summary.trust !== 'trusted') throw new Error('Trust this workspace before opening a preview.')
    const url = new URL(request.url)
    const preview: CodePreviewSummary = { id: previewId('preview'), workspace_id: request.workspace_id, url: url.toString(), origin: url.origin, state: 'open' }
    const workspace = previewCodeWorkspaces.get(request.workspace_id)
    if (workspace) workspace.detail.previews = [preview, ...workspace.detail.previews]
    return preview
  },
  async codeRuns(workspaceId?: string): Promise<CodeRunSummary[]> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeRunSummary[]>('agentic_super_app_query_code_runs', { workspaceId: workspaceId ?? null })
    return [...previewCodeRuns.values()].filter((detail) => !workspaceId || detail.summary.workspace_id === workspaceId).map((detail) => structuredClone(detail.summary)).sort((a, b) => b.updated_at_unix_ms - a.updated_at_unix_ms)
  },
  async codeRun(runId: string): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeRunDetail>('agentic_super_app_query_code_run', { runId })
    return previewCodeRunDetail(runId)
  },
  async createCodeRun(request: CodeRunCreateRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeRunCreateRequest, CodeRunDetail>('agentic_super_app_command_create_code_run', request)
    if (!previewCodeWorkspaces.has(request.workspace_id)) throw new Error('Open a workspace before creating a run.')
    const summary = { ...previewCodeRunSummary(request.workspace_id, request.title, request.objective), review_policy: request.review_policy, concurrency_limit: request.concurrency_limit ?? 2 }
    const detail: CodeRunDetail = { summary, tasks: [], dependencies: [], dispatches: [], worktrees: [], checkpoints: [], reviews: [], questions: [], messages: [], events: [], event_cursor: 0, proposal: null }
    previewCodeRuns.set(summary.id, detail)
    previewCodeRunEvent(detail, 'Run created')
    return structuredClone(detail)
  },
  async updateCodeRun(request: CodeRunUpdateRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeRunUpdateRequest, CodeRunDetail>('agentic_super_app_command_update_code_run', request)
    const detail = previewCodeRuns.get(request.run_id)
    if (!detail) throw new Error('Run was not found.')
    Object.assign(detail.summary, { title: request.title, objective: request.objective, review_policy: request.review_policy, concurrency_limit: request.concurrency_limit ?? detail.summary.concurrency_limit })
    previewCodeRunEvent(detail, 'Run updated')
    return structuredClone(detail)
  },
  async createCodeTask(request: CodeTaskCreateRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeTaskCreateRequest, CodeRunDetail>('agentic_super_app_command_create_code_task', request)
    const detail = previewCodeRuns.get(request.run_id)
    if (!detail) throw new Error('Run was not found.')
    const taskId = previewId('task')
    const now = previewNow()
    const task: CodeTask = { id: taskId, run_id: request.run_id, client_id: request.client_id?.trim() || taskId, title: request.title, specification: request.specification, state: 'draft', position: detail.tasks.length, active_dispatch_id: null, latest_checkpoint_id: null, base_checkpoint_id: null, attempt: 0, error: null, created_at_unix_ms: now, updated_at_unix_ms: now }
    detail.tasks.push(task)
    request.depends_on.forEach((dependency) => { const target = detail.tasks.find((candidate) => candidate.id === dependency || candidate.client_id === dependency); if (target && target.id !== task.id) detail.dependencies.push({ run_id: request.run_id, task_id: task.id, depends_on_task_id: target.id }) })
    previewRecountRun(detail)
    previewCodeRunEvent(detail, 'Task added', task.id)
    return structuredClone(detail)
  },
  async updateCodeTask(request: CodeTaskUpdateRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeTaskUpdateRequest, CodeRunDetail>('agentic_super_app_command_update_code_task', request)
    const detail = previewCodeRuns.get(request.run_id)
    const task = detail?.tasks.find((candidate) => candidate.id === request.task_id || candidate.client_id === request.task_id)
    if (!detail || !task) throw new Error('Task was not found.')
    task.title = request.title; task.specification = request.specification; task.state = 'draft'; task.updated_at_unix_ms = previewNow()
    detail.dependencies = detail.dependencies.filter((dependency) => dependency.task_id !== task.id)
    request.depends_on.forEach((dependency) => { const target = detail.tasks.find((candidate) => candidate.id === dependency || candidate.client_id === dependency); if (target && target.id !== task.id) detail.dependencies.push({ run_id: request.run_id, task_id: task.id, depends_on_task_id: target.id }) })
    previewCodeRunEvent(detail, 'Task updated', task.id)
    return structuredClone(detail)
  },
  async deleteCodeTask(request: CodeTaskDeleteRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeTaskDeleteRequest, CodeRunDetail>('agentic_super_app_command_delete_code_task', request)
    const detail = previewCodeRuns.get(request.run_id)
    if (!detail) throw new Error('Run was not found.')
    const task = detail.tasks.find((candidate) => candidate.id === request.task_id || candidate.client_id === request.task_id)
    if (!task) throw new Error('Task was not found.')
    detail.tasks = detail.tasks.filter((candidate) => candidate.id !== task.id)
    detail.dependencies = detail.dependencies.filter((dependency) => dependency.task_id !== task.id && dependency.depends_on_task_id !== task.id)
    previewRecountRun(detail); previewCodeRunEvent(detail, 'Task deleted', task.id)
    return structuredClone(detail)
  },
  async proposeCodeDag(request: CodeDagProposalRequest): Promise<CodeDagProposal> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeDagProposalRequest, CodeDagProposal>('agentic_super_app_command_propose_code_dag', request)
    return { objective: request.objective, tasks: [{ client_id: 'inspect', title: 'Inspect the repository', specification: 'Inspect the existing repository and identify the smallest safe implementation boundary.', depends_on: [] }, { client_id: 'implement', title: 'Implement the objective', specification: request.objective, depends_on: ['inspect'] }, { client_id: 'verify', title: 'Verify the change', specification: 'Run focused checks and report the result.', depends_on: ['implement'] }], warnings: ['Browser preview uses a deterministic proposal; the desktop host can ask Codex for a reviewed structured proposal.'] }
  },
  async acceptCodeDag(request: CodeDagProposalAcceptRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeDagProposalAcceptRequest, CodeRunDetail>('agentic_super_app_command_accept_code_dag', request)
    const detail = previewCodeRuns.get(request.run_id)
    if (!detail) throw new Error('Run was not found.')
    const ids = new Map(request.proposal.tasks.map((task) => [task.client_id, previewId('task')]))
    const now = previewNow()
    detail.tasks = request.proposal.tasks.map((proposalTask, position) => ({ id: ids.get(proposalTask.client_id)!, run_id: request.run_id, client_id: proposalTask.client_id, title: proposalTask.title, specification: proposalTask.specification, state: 'ready', position, active_dispatch_id: null, latest_checkpoint_id: null, base_checkpoint_id: null, attempt: 0, error: null, created_at_unix_ms: now, updated_at_unix_ms: now }))
    detail.dependencies = request.proposal.tasks.flatMap((task) => task.depends_on.flatMap((dependency) => ids.has(dependency) ? [{ run_id: request.run_id, task_id: ids.get(task.client_id)!, depends_on_task_id: ids.get(dependency)! }] : []))
    detail.proposal = structuredClone(request.proposal); detail.summary.state = 'ready'; previewRecountRun(detail); previewCodeRunEvent(detail, 'DAG proposal accepted')
    return structuredClone(detail)
  },
  async startCodeRun(request: CodeRunRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeRunRequest, CodeRunDetail>('agentic_super_app_command_start_code_run', request)
    const detail = previewCodeRuns.get(request.run_id)
    if (!detail) throw new Error('Run was not found.')
    detail.tasks.forEach((task) => { if (task.state === 'draft' || task.state === 'blocked') task.state = 'ready' })
    detail.summary.state = 'running'; previewCodeRunEvent(detail, 'Run started'); previewAdvanceRun(request.run_id)
    return structuredClone(detail)
  },
  async pauseCodeRun(request: CodeRunRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeRunRequest, CodeRunDetail>('agentic_super_app_command_pause_code_run', request)
    const detail = previewCodeRuns.get(request.run_id); if (!detail) throw new Error('Run was not found.')
    detail.summary.state = 'paused'; previewCodeRunEvent(detail, 'Run paused'); return structuredClone(detail)
  },
  async cancelCodeRun(request: CodeRunRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeRunRequest, CodeRunDetail>('agentic_super_app_command_cancel_code_run', request)
    const detail = previewCodeRuns.get(request.run_id); if (!detail) throw new Error('Run was not found.')
    detail.summary.state = 'cancelled'; previewCodeRunEvent(detail, 'Run cancelled'); return structuredClone(detail)
  },
  async resumeCodeDispatch(request: CodeDispatchResumeRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeDispatchResumeRequest, CodeRunDetail>('agentic_super_app_command_resume_code_dispatch', request)
    const detail = previewCodeRuns.get(request.run_id)
    const dispatch = detail?.dispatches.find((candidate) => candidate.id === request.dispatch_id)
    const task = detail?.tasks.find((candidate) => candidate.id === request.task_id)
    if (!detail || !dispatch || !task || dispatch.state !== 'interrupted' || dispatch.lease_generation !== request.lease_generation) throw new Error('The interrupted dispatch lease is stale.')
    dispatch.state = 'running'; dispatch.lease_generation += 1; task.state = 'running'; detail.summary.state = 'running'; previewCodeRunEvent(detail, 'Interrupted worker resumed', task.id, dispatch.id, 'status'); previewRecountRun(detail); return structuredClone(detail)
  },
  async cancelCodeDispatch(request: CodeDispatchCancelRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeDispatchCancelRequest, CodeRunDetail>('agentic_super_app_command_cancel_code_dispatch', request)
    const detail = previewCodeRuns.get(request.run_id)
    const dispatch = detail?.dispatches.find((candidate) => candidate.id === request.dispatch_id)
    const task = detail?.tasks.find((candidate) => candidate.id === request.task_id)
    if (!detail || !dispatch || !task || dispatch.lease_generation !== request.lease_generation || !['preparing', 'running', 'awaiting_input', 'checkpointing'].includes(dispatch.state)) throw new Error('The dispatch lease is stale.')
    dispatch.state = 'cancelled'; dispatch.cancel_requested_at_unix_ms = previewNow(); task.state = 'cancelled'; task.active_dispatch_id = null; detail.summary.state = 'blocked'; previewCodeRunEvent(detail, 'Dispatch cancelled', task.id, dispatch.id); previewRecountRun(detail); return structuredClone(detail)
  },
  async openCodeDispatchTerminal(request: CodeDispatchTerminalRequest, onEvent: (event: CodeTerminalEvent) => void): Promise<CodeTerminalSummary> {
    if (agenticSuperAppIsTauri) {
      const channel = new Channel<CodeTerminalEvent>(onEvent)
      const result = await invoke<ResponseEnvelope<CodeTerminalSummary>>('agentic_super_app_command_open_code_dispatch_terminal', { command: envelope(request), channel })
      return unwrap(result)
    }
    const detail = previewCodeRunDetail(request.run_id)
    const dispatch = detail.dispatches.find((candidate) => candidate.id === request.dispatch_id)
    if (!dispatch) throw new Error('The dispatch was not found.')
    return this.startCodeTerminal({ workspace_id: detail.summary.workspace_id, kind: 'coding_agent', cols: request.cols, rows: request.rows, adapter_id: dispatch.adapter_id, model: detail.summary.model, resume_session_id: dispatch.session_id }, onEvent)
  },
  async answerCodeQuestion(request: CodeQuestionAnswerRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeQuestionAnswerRequest, CodeRunDetail>('agentic_super_app_command_answer_code_question', request)
    return previewCodeRunDetail(request.run_id)
  },
  async retryCodeTask(request: CodeTaskRetryRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeTaskRetryRequest, CodeRunDetail>('agentic_super_app_command_retry_code_task', request)
    const detail = previewCodeRuns.get(request.run_id); const task = detail?.tasks.find((candidate) => candidate.id === request.task_id)
    if (!detail || !task) throw new Error('Task was not found.')
    task.state = 'ready'; detail.summary.state = 'running'; previewCodeRunEvent(detail, 'Task queued for retry', task.id); previewAdvanceRun(request.run_id); return structuredClone(detail)
  },
  async reviewCodeCheckpoint(request: CodeReviewRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeReviewRequest, CodeRunDetail>('agentic_super_app_command_review_code_checkpoint', request)
    const detail = previewCodeRuns.get(request.run_id); const task = detail?.tasks.find((candidate) => candidate.id === request.task_id)
    if (!detail || !task) throw new Error('Task was not found.')
    task.state = request.decision === 'accept' ? 'completed' : request.decision === 'reject' ? 'failed' : 'ready'; detail.summary.state = request.decision === 'reject' ? 'failed' : 'running'; previewCodeRunEvent(detail, request.decision === 'accept' ? 'Checkpoint accepted' : request.decision === 'reject' ? 'Checkpoint rejected' : 'Changes requested', task.id); previewRecountRun(detail); if (request.decision !== 'reject') previewAdvanceRun(request.run_id); return structuredClone(detail)
  },
  async codeCleanupPreview(request: CodeCleanupPreviewRequest): Promise<CodeCleanupPreview> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeCleanupPreview>('agentic_super_app_query_code_cleanup_preview', { request })
    const detail = previewCodeRunDetail(request.run_id); const worktree = detail.worktrees.find((candidate) => candidate.id === request.worktree_id)
    if (!worktree) throw new Error('Worktree was not found.')
    return { worktree_id: worktree.id, path: worktree.path, branch: worktree.branch, dirty_files: [], locked: worktree.locked, can_remove: !worktree.locked, reason: worktree.locked ? 'The preview worker lease still holds this worktree.' : null }
  },
  async codeCheckpointDiff(request: CodeCheckpointDiffRequest): Promise<CodeGitDiff> {
    if (agenticSuperAppIsTauri) return tauriQuery<CodeGitDiff>('agentic_super_app_query_code_checkpoint_diff', { request })
    const detail = previewCodeRunDetail(request.run_id)
    const checkpoint = detail.checkpoints.find((candidate) => candidate.id === request.checkpoint_id)
    return { workspace_id: detail.summary.workspace_id, relative_path: null, content: checkpoint ? `# Preview checkpoint diff\n${checkpoint.summary}` : '', binary: false, truncated: false }
  },
  async confirmCodeCleanup(request: CodeCleanupConfirmRequest): Promise<CodeRunDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<CodeCleanupConfirmRequest, CodeRunDetail>('agentic_super_app_command_confirm_code_cleanup', request)
    const detail = previewCodeRunDetail(request.run_id); const worktree = detail.worktrees.find((candidate) => candidate.id === request.worktree_id); if (!worktree) throw new Error('Worktree was not found.')
    worktree.state = 'removed'; worktree.locked = false; previewCodeRunEvent(detail, 'Worktree removed', worktree.task_id); return structuredClone(detail)
  },
  subscribeCodeOrchestration(runId: string, onEvent: (event: CodeOrchestrationEventEnvelope) => void, afterSequence = 0): () => void {
    if (agenticSuperAppIsTauri) {
      const channel = new Channel<CodeOrchestrationEventEnvelope>(onEvent)
      void invoke('agentic_super_app_stream_code_orchestration_events', { query: { run_id: runId, after_sequence: afterSequence, limit: 500 }, channel })
      return () => undefined
    }
    const subscriber = (event: CodeOrchestrationEventEnvelope) => { if (event.run_id === runId && event.sequence > afterSequence) onEvent(event) }
    previewCodeSubscribers.add(subscriber); return () => previewCodeSubscribers.delete(subscriber)
  },
  async chooseWorkspacePath(): Promise<string | null> {
    if (!agenticSuperAppIsTauri) return '~/agentic-demo'
    const selected = await openDialog({ multiple: false, directory: true, title: 'Open workspace folder' })
    return typeof selected === 'string' ? selected : null
  },

  async chatSidebar(query: { search?: string; archived: boolean; limit?: number }): Promise<ChatSidebarPage> {
    if (agenticSuperAppIsTauri) return tauriQuery<ChatSidebarPage>('agentic_super_app_query_chat_sidebar', { query: { search: query.search ?? null, archived: query.archived, limit: query.limit ?? 50 } })
    return previewResponse({ conversations: [...previewConversations.values()].map(previewSummary).filter((item) => item.archived === query.archived && (!query.search || `${item.title} ${item.preview ?? ''}`.toLowerCase().includes(query.search.toLowerCase()))).sort((a, b) => b.updated_at_unix_ms - a.updated_at_unix_ms), next_cursor: null })
  },
  async chatConversation(conversationId: string): Promise<ChatConversationDetail> {
    if (agenticSuperAppIsTauri) return tauriQuery<ChatConversationDetail>('agentic_super_app_query_chat_conversation', { conversationId })
    const detail = previewConversations.get(conversationId)
    if (!detail) throw new Error('Conversation was not found.')
    return previewResponse(structuredClone(detail))
  },
  async createChat(title?: string): Promise<ChatConversationDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<ChatCreateRequest, ChatConversationDetail>('agentic_super_app_command_create_chat', { title: title?.trim() || null })
    const detail = previewDetail(title?.trim() || 'New chat')
    previewConversations.set(detail.id, detail)
    return previewResponse(structuredClone(detail))
  },
  async updateChat(payload: { conversation_id: string; title?: string | null; pinned?: boolean | null; archived?: boolean | null }): Promise<ChatConversationDetail> {
    const request: ChatMetadataRequest = { conversation_id: payload.conversation_id, title: payload.title ?? null, pinned: payload.pinned ?? null, archived: payload.archived ?? null }
    if (agenticSuperAppIsTauri) return tauriCommand<ChatMetadataRequest, ChatConversationDetail>('agentic_super_app_command_update_chat', request)
    const detail = previewConversations.get(request.conversation_id)
    if (!detail) throw new Error('Conversation was not found.')
    if (request.title !== null) detail.title = request.title || 'New chat'
    if (request.pinned !== null) detail.pinned = request.pinned
    if (request.archived !== null) detail.archived = request.archived
    detail.updated_at_unix_ms = previewNow()
    return previewResponse(structuredClone(detail))
  },
  async deleteChat(conversationId: string): Promise<boolean> {
    if (agenticSuperAppIsTauri) return tauriCommand<ChatDeleteRequest, boolean>('agentic_super_app_command_delete_chat', { conversation_id: conversationId })
    return previewResponse(previewConversations.delete(conversationId))
  },
  async saveChatDraft(conversationId: string, draft: string): Promise<void> {
    if (agenticSuperAppIsTauri) { await tauriCommand<ChatDraftRequest, null>('agentic_super_app_command_save_chat_draft', { conversation_id: conversationId, draft }); return }
    const detail = previewConversations.get(conversationId)
    if (detail) detail.draft = draft
  },
  async importChatAttachments(request: ChatAttachmentImportRequest): Promise<ChatAttachmentSummary[]> {
    if (agenticSuperAppIsTauri) return tauriCommand<ChatAttachmentImportRequest, ChatAttachmentSummary[]>('agentic_super_app_command_import_chat_attachments', request)
    return previewResponse(request.paths.map((path) => ({ id: previewId('attachment'), display_name: path.split(/[\\/]/).pop() || 'attachment', mime_type: 'text/plain', bytes: 0, sha256: 'preview' })))
  },
  async deleteChatAttachment(request: ChatDeleteAttachmentRequest): Promise<boolean> { return agenticSuperAppIsTauri ? tauriCommand<ChatDeleteAttachmentRequest, boolean>('agentic_super_app_command_delete_chat_attachment', request) : true },
  async startChatTurn(request: ChatSendRequest): Promise<ChatConversationDetail> {
    if (agenticSuperAppIsTauri) return tauriCommand<ChatSendRequest, ChatConversationDetail>('agentic_super_app_command_start_chat_turn', request)
    const detail = previewConversations.get(request.conversation_id)
    if (!detail) throw new Error('Conversation was not found.')
    const now = previewNow()
    const userId = previewId('message')
    const assistantId = previewId('message')
    const turnId = previewId('turn')
    detail.messages.push({ id: userId, branch_id: request.branch_id, role: 'user', parts: [{ kind: 'text', text: request.text }], created_at_unix_ms: now, turn_id: turnId })
    detail.messages.push({ id: assistantId, branch_id: request.branch_id, role: 'assistant', parts: [{ kind: 'text', text: 'Preview response: your local chat vertical slice is connected and ready for a provider key.' }], created_at_unix_ms: now, turn_id: turnId })
    detail.turns.push({ id: turnId, message_id: userId, assistant_message_id: assistantId, branch_id: request.branch_id, provider_account_id: request.provider_account_id, model: request.model, reasoning_effort: request.reasoning_effort, state: 'completed', job_id: 'preview-job', input_tokens: null, output_tokens: null, created_at_unix_ms: now, updated_at_unix_ms: now })
    detail.updated_at_unix_ms = now
    previewEvent(detail, 'assistant_text_appended', assistantId, 'Preview response: your local chat vertical slice is connected and ready for a provider key.', null)
    previewEvent(detail, 'turn_completed', assistantId, null, null)
    return previewResponse(structuredClone(detail))
  },
  async cancelChatTurn(request: ChatTurnRequest): Promise<boolean> { return agenticSuperAppIsTauri ? tauriCommand<ChatTurnRequest, boolean>('agentic_super_app_command_cancel_chat_turn', request) : true },
  async retryChatTurn(request: ChatTurnRequest): Promise<ChatConversationDetail> { return agenticSuperAppIsTauri ? tauriCommand<ChatTurnRequest, ChatConversationDetail>('agentic_super_app_command_retry_chat_turn', request) : this.startChatTurn({ conversation_id: request.conversation_id, branch_id: previewConversations.get(request.conversation_id)?.active_branch_id ?? '', text: 'Retry the previous response.', attachment_ids: [], provider_account_id: previewProvider.id, model: request.model ?? previewProvider.default_model ?? 'preview', reasoning_effort: request.reasoning_effort ?? 'auto' }) },
  async editChatMessage(request: ChatEditRequest): Promise<ChatConversationDetail> { return agenticSuperAppIsTauri ? tauriCommand<ChatEditRequest, ChatConversationDetail>('agentic_super_app_command_edit_chat_message', request) : this.startChatTurn({ conversation_id: request.conversation_id, branch_id: previewConversations.get(request.conversation_id)?.active_branch_id ?? '', text: request.text, attachment_ids: [], provider_account_id: request.provider_account_id, model: request.model, reasoning_effort: request.reasoning_effort }) },
  async branchChat(request: ChatBranchRequest): Promise<ChatConversationDetail> { return agenticSuperAppIsTauri ? tauriCommand<ChatBranchRequest, ChatConversationDetail>('agentic_super_app_command_branch_chat', request) : this.chatConversation(request.conversation_id) },
  async exportChat(request: ChatExportRequest): Promise<boolean> { return agenticSuperAppIsTauri ? tauriCommand<ChatExportRequest, boolean>('agentic_super_app_command_export_chat', request) : true },
  subscribeChat(onEvent: (event: ChatEventEnvelope) => void, afterGlobalSequence = 0): () => void {
    if (!agenticSuperAppIsTauri) { previewSubscribers.add(onEvent); return () => previewSubscribers.delete(onEvent) }
    const channel = new Channel<ChatEventEnvelope>(onEvent)
    void invoke('agentic_super_app_stream_chat_events', { request: { after_global_sequence: afterGlobalSequence }, channel })
    return () => undefined
  },
  async chooseAttachmentPaths(): Promise<string[]> {
    if (!agenticSuperAppIsTauri) return []
    const selected = await openDialog({ multiple: true, directory: false, filters: [{ name: 'Chat attachments', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'txt', 'md', 'markdown'] }] })
    if (!selected) return []
    return Array.isArray(selected) ? selected : [selected]
  },
  async chooseExportDestination(suggestedName = 'chat-export.zip'): Promise<string | null> {
    if (!agenticSuperAppIsTauri) return `${suggestedName}`
    return saveDialog({ defaultPath: suggestedName, filters: [{ name: 'Chat export', extensions: ['zip'] }] })
  },
  async chooseBackupDestination(suggestedName = 'agentic-super-app-backup.zip'): Promise<string | null> {
    if (!agenticSuperAppIsTauri) return suggestedName
    return saveDialog({ defaultPath: suggestedName, filters: [{ name: 'Application backup', extensions: ['zip'] }] })
  },
  async chooseBackupSource(): Promise<string | null> {
    if (!agenticSuperAppIsTauri) return null
    const selected = await openDialog({ multiple: false, directory: false, title: 'Choose an application backup', filters: [{ name: 'Application backup', extensions: ['zip'] }] })
    return typeof selected === 'string' ? selected : null
  },
  isTauri: agenticSuperAppIsTauri,
}
