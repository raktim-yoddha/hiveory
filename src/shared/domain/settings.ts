import type { Viewport } from './browser'

export type ThemeId = 'dark' | 'bronze' | 'silver' | 'midnight' | 'jade' | 'rose'

/** App-wide preferences, persisted with the rest of the domain state. */
export interface AppSettings {
  theme: ThemeId
  /** Check GitHub releases for updates on launch and every few hours. */
  autoCheckUpdates: boolean
  /** Give agents Hiveory's tools (list/read/message/open/arrange agents, terminal) over MCP. */
  agentTools: boolean
  /** Starting value of "Auto-approve permissions" when creating workspaces and presets. */
  defaultAutoApprove: boolean
  /** Starting value of "Use chat UI" when creating workspaces and presets. */
  defaultChatUi: boolean
  /** Give agents the built-in browser (browser_* tools) over MCP. */
  browserUse: boolean
  /** Show the agent's animated cursor and action label while it drives a page. */
  browserAgentCursor: boolean
  /** Address new browser tabs open at ('' = blank page). */
  browserHomeUrl: string
  /** Profile new pages use unless one is chosen. */
  browserDefaultProfile: string
  /** User-defined viewport sizes, listed after the built-in presets. */
  browserViewports: Viewport[]
  /** Give agents computer_* tools: the desktop's mouse, keyboard, windows and screen (Windows). Off by default. */
  computerUse: boolean
  /** Background behind the app: '' (none) or 'image:<file in the wallpapers folder>'. */
  wallpaper: string
  /** How opaque every surface is over a wallpaper (0 = fully transparent, 1 = solid). */
  surfaceOpacity: number
  /** Wallpaper blur in pixels (0–40). */
  wallpaperBlur: number
  /** Darkens the wallpaper so text stays readable (0–0.8). */
  wallpaperDim: number
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  autoCheckUpdates: true,
  agentTools: true,
  defaultAutoApprove: false,
  defaultChatUi: false,
  browserUse: true,
  browserAgentCursor: true,
  browserHomeUrl: '',
  browserDefaultProfile: 'default',
  browserViewports: [],
  computerUse: false,
  wallpaper: '',
  surfaceOpacity: 0.6,
  wallpaperBlur: 0,
  wallpaperDim: 0.25
}

export const THEMES: Array<{ id: ThemeId; name: string; description: string }> = [
  { id: 'dark', name: 'Dark', description: 'Pure black and silver-grey, perfectly flat' },
  { id: 'bronze', name: 'Bronze', description: 'Warm graphite with champagne and bronze accents' },
  { id: 'silver', name: 'Silver', description: 'Cool graphite with brushed-silver accents' },
  { id: 'midnight', name: 'Midnight', description: 'Ink-blue graphite with cold steel highlights' },
  { id: 'jade', name: 'Jade', description: 'Deep obsidian green with polished jade accents' },
  { id: 'rose', name: 'Rose', description: 'Plum graphite with rose-gold accents' }
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
