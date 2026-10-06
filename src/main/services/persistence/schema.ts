import { z } from 'zod'
import { viewportSchema, wallpaperSchema } from '@shared/ipc/contract'
import { parseShortcut } from '@shared/queen/shortcut'
import { MAX_NOTE_LENGTH, MAX_NOTES } from '@shared/queen/actions'
import { customNameProblem } from '@shared/queen/personas'
import { QUEEN_VOICES } from '@shared/queen/voice'
import type { BrainKind } from '@shared/queen/brain'
import type { Bot } from '@shared/domain/bot'
import { MAX_BOT_BRIEF, MAX_BOT_MEMORY, MAX_BOT_NAME, MAX_MEMORY_ENTRY } from '@shared/domain/bot'
import { DEFAULT_SETTINGS, type AgentPreset, type BrowserProfile, type AppSettings, type CliInstance, type LayoutNode, type Project, type Workspace } from '@shared/domain'

/** Persisted domain configuration only — never processes, PTYs or drag state. */
export interface PersistedState {
  version: 1
  projects: Project[]
  workspaces: Workspace[]
  instances: CliInstance[]
  layouts: Record<string, LayoutNode | null>
  presets: AgentPreset[]
  settings: AppSettings
  browserProfiles: BrowserProfile[]
  /** MCP servers and plugins Hiveory runs for every agent (ADR 0017). Secret values are encrypted. */
  connections: StoredConnection[]
  /** Files open as panes in workspace layouts (ADR 0018). */
  editors: StoredEditor[]
  /** Queen Bee's provider accounts in priority order (ADR 0019); keys sealed by SecretBox. */
  queenBrains: StoredBrainAccount[]
  /** Projects removed from Hiveory, kept whole so adding the folder again restores them (ADR 0020). */
  archive: ArchivedProject[]
  /** Bots mode teammates (ADR 0022); their threads are chats in the chats folder. */
  bots: Bot[]
}

/** A removed project with everything that was in it: its workspaces, agents (to resume), layouts and open files. */
export interface ArchivedProject {
  project: Project
  workspaces: Workspace[]
  instances: CliInstance[]
  layouts: Record<string, LayoutNode>
  editors: StoredEditor[]
  removedAt: string
}

/** Removed projects kept for restoring; the oldest beyond this are forgotten. */
export const MAX_ARCHIVED = 30

export interface StoredBrainAccount {
  id: string
  provider: string
  label: string
  kind: BrainKind
  baseUrl: string
  model: string
  /** Sealed API key ('' = none). */
  key: string
  enabled: boolean
}

export interface StoredEditor {
  id: string
  workspaceId: string
  /** Relative to the workspace folder. */
  path: string
}

/** A connection as saved: env and header values are sealed by SecretBox. */
export interface StoredConnection {
  id: string
  name: string
  /** 'composio': the Composio account that serves the plugins (ADR 0023). */
  pluginId?: string
  /** Composio apps connected through Hiveory (toolkit slugs). */
  apps?: string[]
  enabled: boolean
  transport: 'stdio' | 'http'
  command?: string
  args?: string[]
  url?: string
  env: Record<string, string>
  headers: Record<string, string>
  /** Tool list from the last successful connection, so agents see the tools without starting the server. */
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
  error?: string
  importedFrom?: string
  /** A signed-in plugin's OAuth registration and tokens, as one sealed JSON value (ADR 0023). */
  oauth?: string
}

export const emptyState = (): PersistedState => ({
  version: 1,
  projects: [],
  workspaces: [],
  instances: [],
  layouts: {},
  presets: [],
  settings: { ...DEFAULT_SETTINGS },
  browserProfiles: [],
  connections: [],
  editors: [],
  queenBrains: [],
  archive: [],
  bots: []
})

const settingsSchema = z.object({
  theme: z.enum(['dark', 'bronze', 'silver', 'midnight', 'jade', 'rose']).catch(DEFAULT_SETTINGS.theme),
  autoCheckUpdates: z.boolean().catch(DEFAULT_SETTINGS.autoCheckUpdates),
  agentTools: z.boolean().catch(DEFAULT_SETTINGS.agentTools),
  defaultAutoApprove: z.boolean().catch(DEFAULT_SETTINGS.defaultAutoApprove),
  defaultChatUi: z.boolean().catch(DEFAULT_SETTINGS.defaultChatUi),
  browserUse: z.boolean().catch(DEFAULT_SETTINGS.browserUse),
  browserAgentCursor: z.boolean().catch(DEFAULT_SETTINGS.browserAgentCursor),
  browserHomeUrl: z.string().max(2000).catch(DEFAULT_SETTINGS.browserHomeUrl),
  browserDefaultProfile: z.string().max(128).catch(DEFAULT_SETTINGS.browserDefaultProfile),
  browserViewports: z.array(viewportSchema).max(32).catch(DEFAULT_SETTINGS.browserViewports),
  computerUse: z.boolean().catch(DEFAULT_SETTINGS.computerUse),
  keepRunningInBackground: z.boolean().catch(DEFAULT_SETTINGS.keepRunningInBackground),
  wallpaper: wallpaperSchema.catch(DEFAULT_SETTINGS.wallpaper),
  surfaceOpacity: z.number().min(0).max(1).catch(DEFAULT_SETTINGS.surfaceOpacity),
  wallpaperBlur: z.number().min(0).max(40).catch(DEFAULT_SETTINGS.wallpaperBlur),
  wallpaperDim: z.number().min(0).max(0.8).catch(DEFAULT_SETTINGS.wallpaperDim),
  queenPersona: z.enum(['ada', 'sunny', 'frankie', 'custom']).catch(DEFAULT_SETTINGS.queenPersona),
  queenCustomName: z.string().refine((s) => customNameProblem(s) === null).catch(DEFAULT_SETTINGS.queenCustomName),
  queenCustomPersona: z.string().max(500).catch(DEFAULT_SETTINGS.queenCustomPersona),
  queenCustomFormal: z.number().int().min(0).max(100).catch(DEFAULT_SETTINGS.queenCustomFormal),
  queenCustomEnergy: z.number().int().min(0).max(100).catch(DEFAULT_SETTINGS.queenCustomEnergy),
  queenCustomDirect: z.number().int().min(0).max(100).catch(DEFAULT_SETTINGS.queenCustomDirect),
  queenCallMeSay: z.string().max(60).catch(DEFAULT_SETTINGS.queenCallMeSay),
  queenGoal: z.string().max(200).catch(DEFAULT_SETTINGS.queenGoal),
  queenIntensity: z.enum(['steady', 'hard']).catch(DEFAULT_SETTINGS.queenIntensity),
  queenMemory: z.array(z.string().min(1).max(MAX_NOTE_LENGTH)).max(MAX_NOTES).catch(DEFAULT_SETTINGS.queenMemory),
  queenGlobalShortcut: z.boolean().catch(DEFAULT_SETTINGS.queenGlobalShortcut),
  // A voice from an older, longer list falls back to the personality's own.
  queenVoice: z.number().int().refine((v) => v === -1 || QUEEN_VOICES.some((x) => x.sid === v)).catch(DEFAULT_SETTINGS.queenVoice),
  queenCallMe: z.string().max(40).catch(DEFAULT_SETTINGS.queenCallMe),
  queenHonorific: z.enum(['sir', 'maam', 'name', 'none']).catch(DEFAULT_SETTINGS.queenHonorific),
  queenHype: z.enum(['calm', 'lively', 'max']).catch(DEFAULT_SETTINGS.queenHype),
  queenNudgeMinutes: z.number().int().min(0).max(240).catch(DEFAULT_SETTINGS.queenNudgeMinutes),
  queenLength: z.enum(['short', 'normal']).catch(DEFAULT_SETTINGS.queenLength),
  queenShortcut: z.string().refine((s) => parseShortcut(s) !== null).catch(DEFAULT_SETTINGS.queenShortcut),
  queenSpeechLanguage: z.enum(['en', 'es', 'pt', 'de', 'fr', 'hi']).catch(DEFAULT_SETTINGS.queenSpeechLanguage),
  queenTalkback: z.enum(['always', 'after-voice', 'never']).catch(DEFAULT_SETTINGS.queenTalkback),
  queenSounds: z.boolean().catch(DEFAULT_SETTINGS.queenSounds),
  queenUpdates: z.enum(['all', 'waiting', 'off']).catch(DEFAULT_SETTINGS.queenUpdates),
  queenVoiceSpeed: z.number().min(0.8).max(1.4).catch(DEFAULT_SETTINGS.queenVoiceSpeed)
})

const browserProfileSchema: z.ZodType<BrowserProfile> = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), name: z.string(), createdAt: z.string() })

const str = z.string()

export const projectSchema: z.ZodType<Project> = z.object({
  id: str,
  name: str,
  path: str,
  repositoryRoot: str.optional(),
  host: z.object({ kind: z.literal('ssh'), destination: str, port: z.number().int().optional() }).optional(),
  createdAt: str,
  updatedAt: str,
  lastOpenedAt: str
})

export const workspaceSchema: z.ZodType<Workspace> = z.object({
  id: str,
  projectId: str,
  name: str,
  kind: z.enum(['main', 'isolated']),
  path: str,
  git: z
    .object({ worktreePath: str.optional(), branch: str.optional(), baseRef: str.optional(), createdBranch: z.boolean().optional() })
    .optional(),
  association: z.object({ kind: z.enum(['issue', 'pull-request']), ref: str }).optional(),
  autoApprove: z.boolean(),
  chatUi: z.boolean().optional(),
  createdAt: str,
  updatedAt: str
})

export const instanceSchema: z.ZodType<CliInstance> = z.object({
  id: str,
  projectId: str,
  workspaceId: str,
  cliId: str,
  petName: str,
  conversationId: str,
  hasConversation: z.boolean(),
  providerSessionId: str.optional(),
  autoApprove: z.boolean(),
  chatUi: z.boolean().optional(),
  createdAt: str
})

export const layoutSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal('pane'), paneId: str }),
    z
      .object({
        type: z.literal('split'),
        direction: z.enum(['horizontal', 'vertical']),
        children: z.array(layoutSchema).min(2),
        ratios: z.array(z.number().positive().finite())
      })
      // A split whose ratios don't match its children is corrupt; reject it so it gets rebuilt.
      .refine((s) => s.ratios.length === s.children.length)
  ])
)

const stringMap = z.record(z.string(), z.string())
const connectionSchema: z.ZodType<StoredConnection> = z.object({
  id: z.string().regex(/^c[a-z0-9]{1,24}$/),
  name: str,
  pluginId: str.optional(),
  apps: z.array(z.string().regex(/^[a-z0-9_]{1,40}$/)).max(1000).optional(),
  enabled: z.boolean(),
  transport: z.enum(['stdio', 'http']),
  command: str.optional(),
  args: z.array(str).optional(),
  url: str.optional(),
  env: stringMap,
  headers: stringMap,
  tools: z.array(z.object({ name: str, description: z.string(), inputSchema: z.record(z.string(), z.unknown()) })),
  error: str.optional(),
  importedFrom: str.optional(),
  oauth: str.optional()
})

const brainAccountSchema: z.ZodType<StoredBrainAccount> = z.object({
  id: z.string().regex(/^q[a-f0-9]{12}$/),
  provider: z.string().max(40),
  label: z.string().max(40),
  kind: z.enum(['openai', 'anthropic', 'gemini', 'codex', 'claude-code']),
  baseUrl: z.string().max(500),
  model: z.string().max(200),
  key: z.string().max(10_000),
  enabled: z.boolean()
})

/** Queen Bee's accounts; a single model saved by an earlier version becomes the first account. */
const brainAccounts = (input: Record<string, unknown>): StoredBrainAccount[] => {
  const list = Array.isArray(input.queenBrains) ? input.queenBrains.flatMap((a) => brainAccountSchema.safeParse(a).data ?? []) : []
  if (list.length) return list
  const old = z.object({ provider: z.string().max(40), baseUrl: z.string().max(500), model: z.string().max(200), key: z.string().max(10_000) }).safeParse(input.queenBrain).data
  if (!old) return []
  const kind = old.provider === 'anthropic' ? 'anthropic' : old.provider === 'gemini' ? 'gemini' : 'openai'
  return [{ id: 'q000000000001', provider: old.provider, label: '', kind, baseUrl: old.baseUrl, model: old.model, key: old.key, enabled: true }]
}

const editorSchema: z.ZodType<StoredEditor> = z.object({ id: z.string().regex(/^e[a-f0-9]{12}$/), workspaceId: str, path: z.string().min(1).max(1000) })

const archivedSchema: z.ZodType<ArchivedProject> = z.object({
  project: projectSchema,
  workspaces: z.array(workspaceSchema),
  instances: z.array(instanceSchema),
  layouts: z.record(z.string(), layoutSchema),
  editors: z.array(editorSchema),
  removedAt: str
})

export const presetSchema: z.ZodType<AgentPreset> = z.object({
  id: str,
  name: str,
  cliSelections: z.array(z.object({ cliId: str, count: z.number().int().positive() })),
  autoApprove: z.boolean(),
  chatUi: z.boolean().optional()
})

export const botSchema: z.ZodType<Bot> = z.object({
  id: str,
  name: z.string().min(1).max(MAX_BOT_NAME),
  brief: z.string().max(MAX_BOT_BRIEF).catch(''),
  cliId: str.optional(),
  model: str.optional(),
  effort: str.optional(),
  autoApprove: z.boolean().catch(false),
  chief: z.boolean().catch(false),
  messaging: z.boolean().catch(true),
  memory: z.array(z.string().max(MAX_MEMORY_ENTRY)).max(MAX_BOT_MEMORY).catch([]),
  pinned: z.boolean().catch(false),
  computer: z
    .object({ kind: z.literal('docker'), host: z.object({ kind: z.literal('ssh'), destination: str, port: z.number().int().optional() }).optional() })
    .optional()
    .catch(undefined),
  createdAt: str,
  updatedAt: str
})

/** At most one Chief of Staff survives a hand-edited or corrupt file: the first one. */
const oneChief = (bots: Bot[]): Bot[] => {
  let seen = false
  return bots.map((b) => {
    if (!b.chief) return b
    if (seen) return { ...b, chief: false }
    seen = true
    return b
  })
}

/**
 * Parses each record independently so one corrupt entry is dropped instead of
 * discarding everything. Returns how many records were rejected.
 */
export const parseState = (raw: unknown): { state: PersistedState; rejected: number } => {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  let rejected = 0
  const list = <T>(value: unknown, schema: z.ZodType<T>): T[] =>
    (Array.isArray(value) ? value : []).flatMap((item) => {
      const parsed = schema.safeParse(item)
      if (parsed.success) return [parsed.data]
      rejected++
      return []
    })
  const layouts: Record<string, LayoutNode | null> = {}
  const rawLayouts = typeof input.layouts === 'object' && input.layouts !== null ? input.layouts : {}
  for (const [key, value] of Object.entries(rawLayouts)) {
    if (value === null) continue
    const parsed = layoutSchema.safeParse(value)
    if (parsed.success) layouts[key] = parsed.data
    else rejected++
  }
  return {
    state: {
      version: 1,
      projects: list(input.projects, projectSchema),
      workspaces: list(input.workspaces, workspaceSchema),
      instances: list(input.instances, instanceSchema),
      layouts,
      presets: list(input.presets, presetSchema),
      // Unknown or invalid settings fall back to defaults field by field.
      settings: settingsSchema.parse(typeof input.settings === 'object' && input.settings !== null ? input.settings : {}),
      browserProfiles: list(input.browserProfiles, browserProfileSchema),
      // Key-based plugins were replaced by the Composio account (ADR 0023): their saved keys are dropped.
      connections: list(input.connections, connectionSchema).filter((c) => !c.pluginId || c.pluginId === 'composio'),
      editors: list(input.editors, editorSchema),
      queenBrains: brainAccounts(input),
      archive: list(input.archive, archivedSchema),
      bots: oneChief(list(input.bots, botSchema))
    },
    rejected
  }
}
