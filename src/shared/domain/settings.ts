export type ThemeId = 'bronze' | 'silver'

/** App-wide preferences, persisted with the rest of the domain state. */
export interface AppSettings {
  theme: ThemeId
  /** Check GitHub releases for updates on launch and every few hours. */
  autoCheckUpdates: boolean
  /** Give agents Hiveory's tools (list/read/message/open/arrange agents, terminal) over MCP. */
  agentTools: boolean
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'bronze',
  autoCheckUpdates: true,
  agentTools: true
}

export const THEMES: Array<{ id: ThemeId; name: string; description: string }> = [
  { id: 'bronze', name: 'Bronze', description: 'Warm graphite with champagne and bronze accents' },
  { id: 'silver', name: 'Silver', description: 'Cool graphite with brushed-silver accents' }
]

export type UpdateStatus =
  | { state: 'unsupported'; reason: string }
  | { state: 'idle'; lastChecked?: string }
  | { state: 'checking' }
  | { state: 'available'; version: string; notes?: string }
  | { state: 'not-available'; lastChecked: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }
