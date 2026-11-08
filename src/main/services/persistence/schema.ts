import { z } from 'zod'
import { viewportSchema, wallpaperSchema } from '@shared/ipc/contract'
import { cleanKeybindings } from '@shared/keys/keybindings'
import { VSCODE_THEME_ID } from '@shared/domain/vscode-theme'
import { CODE_HOSTS, TRACKERS } from '@shared/domain/integrations'
import { MAX_PROMPT_TITLE, MAX_SAVED_PROMPT_TEXT, MAX_SAVED_PROMPTS, type SavedPrompt } from '@shared/domain/prompt'
import { INTERVAL_MINUTES, MAX_ROUTINE_NAME, MAX_ROUTINE_PROMPT, MAX_ROUTINE_RUNS, REPEAT_PRESETS, type Routine, type RoutineRun } from '@shared/domain/routine'
import { DEFAULT_SETTINGS, DETACHED_GRACES, THEME_IDS, safeTerminalFont, UPDATE_CHECK_EVERY, UPDATE_REMIND_EVERY, AVATAR_DATA, EMOJI, HEX_COLOR, MAX_AVATAR_CHARS, WORKSPACE_COLORS, WORKSPACE_ICONS, type AgentPreset, type BrowserProfile, type AppSettings, type CliInstance, type LayoutNode, type Project, type Workspace } from '@shared/domain'

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
  /** MCP servers and apps Hiveory runs for every agent (ADR 0017). Secret values are encrypted. */
  connections: StoredConnection[]
  /** Files open as panes in workspace layouts (ADR 0018). */
  editors: StoredEditor[]
  /** Projects removed from Hiveory, kept whole so adding the folder again restores them (ADR 0020). */
  archive: ArchivedProject[]
  /** Worktrees' scheduled work (ADR 0028, 0040). */
  routines: Routine[]
  /** The run log, newest first, at most MAX_ROUTINE_RUNS. */
  routineRuns: RoutineRun[]
  /** Issue trackers connected in Settings › Integrations (ADR 0040); keys sealed by SecretBox. */
  trackers?: StoredTrackers
  /** The user's saved prompts, newest first (ADR 0031). */
  savedPrompts: SavedPrompt[]
}

export interface StoredTrackers {
  jira?: { site: string; email: string; token: string }
  linear?: { key: string }
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
  /** 'composio': the Composio connection that serves the apps (ADR 0023). */
  provider?: string
  /** Apps with an active account in Composio (toolkit slugs), for the agent prompt. */
  apps?: string[]
  /** The Composio tool-router session that serves agents (ADR 0023). */
  session?: string
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
  archive: [],
  routines: [],
  routineRuns: [],
  savedPrompts: []
})

const settingsSchema = z.object({
  // A theme since removed (Midnight, Jade, Rose; ADR 0044) falls back to Dark.
  theme: z.enum(THEME_IDS).catch(DEFAULT_SETTINGS.theme),
  vscodeTheme: z.union([z.literal(''), z.string().regex(VSCODE_THEME_ID)]).catch(DEFAULT_SETTINGS.vscodeTheme),
  autoCheckUpdates: z.boolean().catch(DEFAULT_SETTINGS.autoCheckUpdates),
  autoDownloadUpdates: z.boolean().catch(DEFAULT_SETTINGS.autoDownloadUpdates),
  // Clamped field by field: a hand-edited or older file can never break terminals (ADR 0039).
  terminalFont: z.unknown().optional().transform((v) => safeTerminalFont(v)),
  updateCheckEvery: z.enum(UPDATE_CHECK_EVERY).catch(DEFAULT_SETTINGS.updateCheckEvery),
  updateRemindEvery: z.enum(UPDATE_REMIND_EVERY).catch(DEFAULT_SETTINGS.updateRemindEvery),
  agentTools: z.boolean().catch(DEFAULT_SETTINGS.agentTools),
  defaultAutoApprove: z.boolean().catch(DEFAULT_SETTINGS.defaultAutoApprove),
  browserUse: z.boolean().catch(DEFAULT_SETTINGS.browserUse),
  browserAgentCursor: z.boolean().catch(DEFAULT_SETTINGS.browserAgentCursor),
  browserHomeUrl: z.string().max(2000).catch(DEFAULT_SETTINGS.browserHomeUrl),
  browserDefaultProfile: z.string().max(128).catch(DEFAULT_SETTINGS.browserDefaultProfile),
  browserViewports: z.array(viewportSchema).max(32).catch(DEFAULT_SETTINGS.browserViewports),
  computerUse: z.boolean().catch(DEFAULT_SETTINGS.computerUse),
  keepRunningInBackground: z.boolean().catch(DEFAULT_SETTINGS.keepRunningInBackground),
  keepAgentsAfterQuit: z.boolean().catch(DEFAULT_SETTINGS.keepAgentsAfterQuit),
  detachedGrace: z.enum(DETACHED_GRACES).catch(DEFAULT_SETTINGS.detachedGrace),
  keepAwakeForRoutines: z.boolean().catch(DEFAULT_SETTINGS.keepAwakeForRoutines),
  shareOnTailnet: z.boolean().catch(DEFAULT_SETTINGS.shareOnTailnet),
  shareOnLan: z.boolean().catch(DEFAULT_SETTINGS.shareOnLan),
  petLink: z.boolean().catch(DEFAULT_SETTINGS.petLink),
  wallpaper: wallpaperSchema.catch(DEFAULT_SETTINGS.wallpaper),
  surfaceOpacity: z.number().min(0).max(1).catch(DEFAULT_SETTINGS.surfaceOpacity),
  wallpaperBlur: z.number().min(0).max(40).catch(DEFAULT_SETTINGS.wallpaperBlur),
  wallpaperDim: z.number().min(0).max(0.8).catch(DEFAULT_SETTINGS.wallpaperDim),
  keybindings: z.record(z.string(), z.unknown()).transform(cleanKeybindings).catch(DEFAULT_SETTINGS.keybindings)
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
  lastOpenedAt: str,
  lastActiveAt: str.optional(),
  // A damaged settings object is dropped, never the Workspace (ADR 0037).
  settings: z
    .object({
      chatDefaults: z.record(str, z.object({ model: str, effort: str })).optional(),
      branchPrefix: str.optional(),
      baseRef: str.optional(),
      alerts: z.boolean().optional(),
      icon: z.enum(WORKSPACE_ICONS).optional().catch(undefined),
      color: z.enum(WORKSPACE_COLORS).optional().catch(undefined),
      customColor: z.string().regex(HEX_COLOR).optional().catch(undefined),
      avatar: z.string().max(MAX_AVATAR_CHARS).regex(AVATAR_DATA).optional().catch(undefined),
      emoji: z.string().regex(EMOJI).optional().catch(undefined),
      codeHost: z.enum([...CODE_HOSTS, 'none']).optional().catch(undefined),
      issueSource: z.enum([...TRACKERS, 'none']).optional().catch(undefined),
      trackerGroup: str.optional()
    })
    .optional()
    .catch(undefined)
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
    z
      .object({ type: z.literal('pane'), paneId: str, tabs: z.array(str).min(2).max(64).optional() })
      // An area's tabs must include the one it shows; anything else is corrupt.
      .refine((p) => !p.tabs || p.tabs.includes(p.paneId)),
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
  provider: str.optional(),
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
  session: str.optional()
})

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
  autoApprove: z.boolean()
})

const isoDate = z.string().datetime({ offset: true })

export const routineSchema: z.ZodType<Routine> = z.object({
  id: str,
  name: z.string().min(1).max(MAX_ROUTINE_NAME),
  target: z.object({ kind: z.literal('workspace'), projectId: str, workspaceId: str, cliId: str }),
  prompt: z.string().min(1).max(MAX_ROUTINE_PROMPT),
  attachments: z
    .array(z.object({ name: str, path: str, kind: z.enum(['image', 'video', 'text', 'file']), size: z.number().int().min(0) }))
    .optional()
    .catch(undefined),
  schedule: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('once') }),
    z.object({ kind: z.literal('interval'), everyMinutes: z.number().int().min(INTERVAL_MINUTES.min).max(INTERVAL_MINUTES.max) }),
    z.object({ kind: z.literal('cron'), expr: z.string().min(1).max(120), preset: z.enum(REPEAT_PRESETS).catch('custom') })
  ]),
  startsAt: isoDate,
  timezone: z.string().min(1).max(64),
  endsAt: isoDate.optional().catch(undefined),
  timeoutMinutes: z.number().int().positive().optional().catch(undefined),
  enabled: z.boolean().catch(false),
  checkedThrough: isoDate,
  createdAt: str,
  updatedAt: str
})

const savedPromptSchema: z.ZodType<SavedPrompt> = z.object({
  id: str,
  title: z.string().min(1).max(MAX_PROMPT_TITLE),
  text: z.string().min(1).max(MAX_SAVED_PROMPT_TEXT),
  createdAt: str
})

const trackersSchema: z.ZodType<StoredTrackers> = z.object({
  jira: z.object({ site: z.string().regex(/^https:\/\/[a-z0-9.-]+(:\d+)?$/), email: str, token: str }).optional().catch(undefined),
  linear: z.object({ key: str }).optional().catch(undefined)
})

export const routineRunSchema: z.ZodType<RoutineRun> = z.object({
  id: str,
  routineId: str,
  routineName: str,
  where: str.optional(),
  agentId: str.optional(),
  trigger: z.enum(['schedule', 'manual']),
  prompt: str,
  scheduledFor: str,
  startedAt: str.optional(),
  endedAt: str.optional(),
  status: z.enum(['running', 'completed', 'failed', 'missed', 'skipped']),
  detail: str.optional()
})

/** Keeps the saved records `keep` accepts; anything else in the list is left for its schema to judge. */
const workOnly = (value: unknown, keep: (record: Record<string, unknown>) => boolean): unknown =>
  Array.isArray(value) ? value.filter((v: unknown) => typeof v !== 'object' || v === null || keep(v as Record<string, unknown>)) : value

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
      // Key-based plugins were replaced by Composio apps (ADR 0023): their saved keys are dropped.
      // Older files name the provider `pluginId`.
      connections: list(
        Array.isArray(input.connections)
          ? input.connections.map((c: unknown) => (c && typeof c === 'object' && 'pluginId' in c ? { ...c, provider: (c as { pluginId: unknown }).pluginId } : c))
          : input.connections,
        connectionSchema
      ).filter((c) => !c.provider || c.provider === 'composio'),
      editors: list(input.editors, editorSchema),
      archive: list(input.archive, archivedSchema),
      // Bots' routines, scheduled chats and their runs went with Bots and Chat (ADR 0056): dropped quietly.
      routines: list(workOnly(input.routines, (r) => !r.botId && (r.target as { kind?: unknown } | undefined)?.kind === 'workspace'), routineSchema),
      routineRuns: list(workOnly(input.routineRuns, (r) => !r.botId && !r.threadId && r.trigger !== 'event'), routineRunSchema).slice(0, MAX_ROUTINE_RUNS),
      savedPrompts: list(input.savedPrompts, savedPromptSchema).slice(0, MAX_SAVED_PROMPTS),
      ...(trackersSchema.safeParse(input.trackers).success ? { trackers: trackersSchema.parse(input.trackers) } : {})
    },
    rejected
  }
}
