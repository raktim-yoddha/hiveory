import { Channel, invoke } from '@tauri-apps/api/core'

export type ApplicationMode = 'agent' | 'code' | 'chat'
export type JobState = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted'
export type ProviderAccountSummary = { id: string; display_name: string; default_model: string | null; secret_configured: boolean; enabled: boolean }
export type JobSummary = { id: string; kind: string; state: JobState; created_at_unix_ms: number; updated_at_unix_ms: number; error_code: string | null }
export type NotificationSummary = { id: string; title: string; body: string; severity: string; read: boolean; created_at_unix_ms: number }
export type SharedEventEnvelope = { sequence: number; kind: string; job_id: string | null; message: string | null; text_delta: string | null }
export type DiagnosticSnapshot = { providers: ProviderAccountSummary[]; recent_jobs: JobSummary[]; notifications: NotificationSummary[]; recovery_message: string | null }
export type BootstrapSnapshot = { protocol: { major: number }; active_mode: ApplicationMode; product_name: string }

const agenticSuperAppIsTauri = '__TAURI_INTERNALS__' in window
const previewProvider: ProviderAccountSummary = { id: 'agentic-super-app-openai', display_name: 'OpenAI Responses', default_model: null, secret_configured: false, enabled: true }

export const agenticSuperAppClient = {
  async bootstrap(): Promise<BootstrapSnapshot> { return agenticSuperAppIsTauri ? invoke('agentic_super_app_query_bootstrap') : { protocol: { major: 1 }, active_mode: 'agent', product_name: 'Agentic Super App' } },
  async setActiveMode(mode: ApplicationMode): Promise<BootstrapSnapshot> { return agenticSuperAppIsTauri ? invoke('agentic_super_app_command_set_active_mode', { command: { mode } }) : { protocol: { major: 1 }, active_mode: mode, product_name: 'Agentic Super App' } },
  async diagnostics(): Promise<DiagnosticSnapshot> { return agenticSuperAppIsTauri ? invoke('agentic_super_app_query_diagnostic_snapshot') : { providers: [previewProvider], recent_jobs: [], notifications: [], recovery_message: null } },
  async configureModel(model: string): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_configure_openai_provider', { model }) },
  async setSecret(secret: string): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_set_openai_secret', { secret }) },
  async validateProvider(): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_validate_openai_provider') },
  async startDiagnostic(request: { providerAccountId: string; model: string; prompt: string }): Promise<string> { return agenticSuperAppIsTauri ? invoke('agentic_super_app_command_start_provider_diagnostic', { request: { provider_account_id: request.providerAccountId, model: request.model, prompt: request.prompt } }) : 'preview-job' },
  async cancelJob(jobId: string): Promise<boolean> { return agenticSuperAppIsTauri ? invoke('agentic_super_app_command_cancel_job', { jobId }) : true },
  subscribe(onEvent: (event: SharedEventEnvelope) => void): void { if (agenticSuperAppIsTauri) void invoke('agentic_super_app_stream_shared_events', { channel: new Channel<SharedEventEnvelope>(onEvent) }) },
  async testNotification(): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_send_test_notification') },
  async restartRecovery(): Promise<void> { if (agenticSuperAppIsTauri) await invoke('agentic_super_app_command_prepare_restart_recovery') },
  isTauri: agenticSuperAppIsTauri,
}
