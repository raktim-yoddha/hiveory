import type { Viewport } from './browser'

export type ThemeId = 'dark' | 'bronze' | 'silver' | 'midnight' | 'jade' | 'rose'

/** App-wide preferences, persisted with the rest of the domain state. */
export interface AppSettings {
  theme: ThemeId
  /** Check GitHub releases for updates on launch and every few hours. */
  autoCheckUpdates: boolean
  /** Download a found update in the background; it installs on restart or quit. */
  autoDownloadUpdates: boolean
  /** Terminal panes' typeface and text rendering (Settings › Appearance › Terminal font; ADR 0039). */
  terminalFont: TerminalFont
  /** How often automatic checks run (they also run on launch; ADR 0039). */
  updateCheckEvery: UpdateCheckEvery
  /** An update is overdue two days after its release; a dismissed reminder comes back after this. */
  updateRemindEvery: UpdateRemindEvery
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
  /** Closing the window keeps Hiveory (and every agent) running in the tray; Quit stops them. */
  keepRunningInBackground: boolean
  /** While plugged in, keep this computer from idle-sleeping in the hour before a routine and while one runs (ADR 0028). */
  keepAwakeForRoutines: boolean
  /** Share this computer with the user's other devices over Tailscale (ADR 0025). Off by default. */
  shareOnTailnet: boolean
  /** Background behind the app: '' (none) or 'image:<file in the wallpapers folder>'. */
  wallpaper: string
  /** How opaque every surface is over a wallpaper (0 = fully transparent, 1 = solid). */
  surfaceOpacity: number
  /** Wallpaper blur in pixels (0–40). */
  wallpaperBlur: number
  /** Darkens the wallpaper so text stays readable (0–0.8). */
  wallpaperDim: number
  /** Applied VS Code color theme (`<extension>/<slug>`, ADR 0034); '' = the built-in `theme`. */
  vscodeTheme: string
  /** Queen Bee's personality (ADR 0019). */
  queenPersona: 'ada' | 'sunny' | 'frankie' | 'custom'
  /** Custom personality: her name (never an agent pet name). */
  queenCustomName: string
  /** Custom personality: how she should come across, in the user's words (≤ 500 chars; style only). */
  queenCustomPersona: string
  /** Custom personality sliders, 0–100. formal (100) ← → casual (0). */
  queenCustomFormal: number
  /** energetic (100) ← → calm (0). */
  queenCustomEnergy: number
  /** direct (100) ← → gentle (0). */
  queenCustomDirect: number
  /** How she should say your name aloud ('' = as written). */
  queenCallMeSay: string
  /** Frankie: the goal and deadline she keeps you honest about ('' = none). */
  queenGoal: string
  /** Frankie: how hard she pushes. */
  queenIntensity: 'steady' | 'hard'
  /** Things she's learned: notes the user asked her to remember. Local only. */
  queenMemory: string[]
  /** Her shortcut also works while another app is focused (native keyboard hook; opt-in). */
  queenGlobalShortcut: boolean
  /** Kokoro speaker id, or -1 for the personality's own voice. */
  queenVoice: number
  /** What Queen Bee calls you ('' = nothing). */
  queenCallMe: string
  /** Ada: how she addresses you. */
  queenHonorific: 'sir' | 'maam' | 'name' | 'none'
  /** Sunny: celebration level. */
  queenHype: 'calm' | 'lively' | 'max'
  /** Frankie: minutes an agent may wait on you before she calls it out (0 = never). */
  queenNudgeMinutes: number
  /** Short replies drop the second sentence. */
  queenLength: 'short' | 'normal'
  /** Tap to focus Queen Bee, hold to talk: "Meta+Alt" = Win+Alt / ⌘⌥ (see shared/queen/shortcut.ts). */
  queenShortcut: string
  /** The language Queen Bee listens in (picks the speech pack). */
  queenSpeechLanguage: 'en' | 'es' | 'pt' | 'de' | 'fr' | 'hi'
  /** Talkback: when she answers out loud (Kokoro when installed, otherwise the system voice). */
  queenTalkback: 'always' | 'after-voice' | 'never'
  /** Short sound cues: listening, done, an agent update. */
  queenSounds: boolean
  /** Live updates from agents: finished and waiting, only waiting, or none. */
  queenUpdates: 'all' | 'waiting' | 'off'
  /** Her replies pop open over the work; off (default), they wait behind her message button (ADR 0039). */
  queenPopups: boolean
  /** Speaking speed (0.8–1.4). */
  queenVoiceSpeed: number
}

export const FONT_WEIGHTS = ['100', '200', '300', '400', '500', '600', '700', '800', '900'] as const
export type FontWeight = (typeof FONT_WEIGHTS)[number]

export interface TerminalFont {
  /** An installed family name; '' = the default (JetBrainsMono Nerd Font when installed, else the bundled JetBrains Mono). */
  family: string
  /** Base size in pt (a narrow pane still zooms out below it). */
  size: number
  lineHeight: number
  weight: FontWeight
  boldWeight: FontWeight
  /** Off: italic text is drawn upright. */
  italic: boolean
  /** Bold text in the bright variant of its color, as classic terminals do. */
  boldBright: boolean
}

/** Every value is clamped to these, whatever a stored file or a request says, so text always renders. */
export const TERMINAL_FONT_LIMITS = { size: { min: 8, max: 32 }, lineHeight: { min: 1, max: 2 } } as const
/** Family names as fonts are named: letters, digits, spaces and a little punctuation (it is quoted into a font list). */
export const FONT_FAMILY = /^[\p{L}\p{N} ._+&()'-]{0,100}$/u

/** A stored or requested font made safe: unknown fields dropped, numbers clamped, bad names cleared. */
export const safeTerminalFont = (value: unknown): TerminalFont => {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Partial<Record<keyof TerminalFont, unknown>>
  const d = DEFAULT_TERMINAL_FONT
  const num = (x: unknown, fallback: number, { min, max }: { min: number; max: number }, step: number): number =>
    typeof x === 'number' && Number.isFinite(x) ? Math.round(Math.min(max, Math.max(min, x)) / step) * step : fallback
  const weight = (x: unknown, fallback: FontWeight): FontWeight => ((FONT_WEIGHTS as readonly unknown[]).includes(x) ? (x as FontWeight) : fallback)
  return {
    family: typeof v.family === 'string' && FONT_FAMILY.test(v.family) ? v.family.trim() : d.family,
    size: num(v.size, d.size, TERMINAL_FONT_LIMITS.size, 1),
    lineHeight: Number(num(v.lineHeight, d.lineHeight, TERMINAL_FONT_LIMITS.lineHeight, 0.01).toFixed(2)),
    weight: weight(v.weight, d.weight),
    boldWeight: weight(v.boldWeight, d.boldWeight),
    italic: typeof v.italic === 'boolean' ? v.italic : d.italic,
    boldBright: typeof v.boldBright === 'boolean' ? v.boldBright : d.boldBright
  }
}

export const DEFAULT_TERMINAL_FONT: TerminalFont = {
  family: '',
  size: 13,
  lineHeight: 1.15,
  weight: '400',
  boldWeight: '700',
  italic: true,
  boldBright: true
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  autoCheckUpdates: true,
  autoDownloadUpdates: false,
  terminalFont: DEFAULT_TERMINAL_FONT,
  updateCheckEvery: '6h',
  updateRemindEvery: '2h',
  agentTools: true,
  defaultAutoApprove: false,
  defaultChatUi: false,
  browserUse: true,
  browserAgentCursor: true,
  browserHomeUrl: '',
  browserDefaultProfile: 'default',
  browserViewports: [],
  computerUse: false,
  keepRunningInBackground: true,
  keepAwakeForRoutines: true,
  shareOnTailnet: false,
  wallpaper: '',
  surfaceOpacity: 0.6,
  wallpaperBlur: 0,
  wallpaperDim: 0.25,
  vscodeTheme: '',
  queenPersona: 'ada',
  queenCustomName: 'Zara',
  queenCustomPersona: '',
  queenCustomFormal: 50,
  queenCustomEnergy: 50,
  queenCustomDirect: 50,
  queenCallMeSay: '',
  queenGoal: '',
  queenIntensity: 'steady',
  queenMemory: [],
  queenGlobalShortcut: false,
  queenVoice: -1,
  queenCallMe: '',
  queenHonorific: 'none',
  queenHype: 'lively',
  queenNudgeMinutes: 10,
  queenLength: 'normal',
  queenShortcut: 'Meta+Alt',
  queenSpeechLanguage: 'en',
  queenTalkback: 'always',
  queenSounds: true,
  queenUpdates: 'all',
  queenPopups: false,
  queenVoiceSpeed: 1.05
}

export const THEMES: Array<{ id: ThemeId; name: string; description: string }> = [
  { id: 'dark', name: 'Dark', description: 'Pure black and silver-grey, perfectly flat' },
  { id: 'bronze', name: 'Bronze', description: 'Warm graphite with champagne and bronze accents' },
  { id: 'silver', name: 'Silver', description: 'Cool graphite with brushed-silver accents' },
  { id: 'midnight', name: 'Midnight', description: 'Ink-blue graphite with cold steel highlights' },
  { id: 'jade', name: 'Jade', description: 'Deep obsidian green with polished jade accents' },
  { id: 'rose', name: 'Rose', description: 'Plum graphite with rose-gold accents' }
]


export const UPDATE_CHECK_EVERY = ['hourly', '6h', 'daily'] as const
export type UpdateCheckEvery = (typeof UPDATE_CHECK_EVERY)[number]
export const UPDATE_REMIND_EVERY = ['2h', '4h', '8h', 'daily'] as const
export type UpdateRemindEvery = (typeof UPDATE_REMIND_EVERY)[number]

const HOUR_MS = 60 * 60 * 1000
export const UPDATE_INTERVAL_MS: Record<UpdateCheckEvery | UpdateRemindEvery, number> = {
  hourly: HOUR_MS,
  '2h': 2 * HOUR_MS,
  '4h': 4 * HOUR_MS,
  '6h': 6 * HOUR_MS,
  '8h': 8 * HOUR_MS,
  daily: 24 * HOUR_MS
}
/** An update not installed this long after its release is overdue (its reminder keeps coming back). */
export const UPDATE_OVERDUE_MS = 2 * 24 * HOUR_MS

/** Whether a release is overdue at `now`; an unknown release date never is. */
export const updateOverdue = (releaseDate: string | undefined, now = Date.now()): boolean =>
  Boolean(releaseDate) && now - Date.parse(releaseDate!) >= UPDATE_OVERDUE_MS

export type UpdateStatus =
  | { state: 'unsupported'; reason: string }
  | { state: 'idle'; lastChecked?: string }
  | { state: 'checking' }
  | { state: 'available'; version: string; notes?: string; releaseDate?: string }
  | { state: 'not-available'; lastChecked: string }
  | { state: 'downloading'; version: string; percent: number; notes?: string; releaseDate?: string }
  | { state: 'downloaded'; version: string; notes?: string; releaseDate?: string }
  | { state: 'error'; message: string }
