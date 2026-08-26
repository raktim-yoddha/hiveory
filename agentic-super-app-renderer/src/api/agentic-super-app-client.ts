import { invoke } from '@tauri-apps/api/core'

export type ApplicationMode = 'agent' | 'code' | 'chat'
export type BootstrapSnapshot = { protocol: { major: number }; active_mode: ApplicationMode; product_name: string }

const agenticSuperAppIsTauri = '__TAURI_INTERNALS__' in window

export const agenticSuperAppClient = {
  async bootstrap(): Promise<BootstrapSnapshot> {
    if (!agenticSuperAppIsTauri) return { protocol: { major: 1 }, active_mode: 'agent', product_name: 'Agentic Super App' }
    return invoke<BootstrapSnapshot>('agentic_super_app_query_bootstrap')
  },
  async setActiveMode(mode: ApplicationMode): Promise<BootstrapSnapshot> {
    if (!agenticSuperAppIsTauri) return { protocol: { major: 1 }, active_mode: mode, product_name: 'Agentic Super App' }
    return invoke<BootstrapSnapshot>('agentic_super_app_command_set_active_mode', { command: { mode } })
  },
}
