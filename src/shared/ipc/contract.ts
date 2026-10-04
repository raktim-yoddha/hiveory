import { z } from 'zod'
import type {
  AgentPreset,
  AppSettings,
  UpdateStatus,
  CliDescriptor,
  CliInstanceView,
  CliRuntimeDetails,
  KanbanBoard,
  LayoutNode,
  Project,
  WorkspaceView
} from '../domain'
import type { ChatCatalog, ChatMessage, ChatSession, ChatSummary } from '../domain/chat'
import type { ExtensionsInventory } from '../domain/extensions'
import type { GithubIssue, GithubStatus, GitInfo, PullRequest } from '../domain/github'

/**
 * The complete renderer ↔ main contract. Main validates every payload against
 * these schemas; the preload only forwards channels listed here.
 */

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
const side = z.enum(['left', 'right', 'top', 'bottom'])

export const MAX_INSTANCES_PER_CLI = 8

export const cliSelectionSchema = z.object({
  cliId: id,
  count: z.number().int().min(0).max(MAX_INSTANCES_PER_CLI)
})

export const presetInputSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(60),
  cliSelections: z.array(cliSelectionSchema).max(32),
  autoApprove: z.boolean()
})

export const layoutOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), paneId: id, targetPaneId: id, side }),
  z.object({ type: z.literal('dock'), paneId: id, side }),
  z.object({ type: z.literal('swap'), paneId: id, targetPaneId: id }),
  z.object({ type: z.literal('arrange'), mode: z.enum(['equal', 'focus', 'columns']), focusPaneId: id.optional() }),
  z.object({
    type: z.literal('resize'),
    path: z.array(z.number().int().min(0).max(64)).max(32),
    ratios: z.array(z.number().positive().finite()).min(2).max(64)
  })
])

/** Branch / ref names: Git-safe characters only (main re-validates with git check-ref-format). */
const gitRef = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._/-]+$/)
  .refine((v) => !v.startsWith('-'))

export const createWorkspaceSchema = z.object({
  projectId: id,
  /** `main` uses the project folder itself; `isolated` gets a linked worktree + branch. */
  kind: z.enum(['main', 'isolated']).default('isolated'),
  name: z.string().trim().min(1).max(60),
  association: z
    .object({ kind: z.enum(['issue', 'pull-request']), ref: z.string().trim().min(1).max(300) })
    .optional(),
  cliSelections: z.array(cliSelectionSchema).max(32),
  autoApprove: z.boolean(),
  /** Isolated only: base ref for a new branch (default: the repository's default branch). */
  baseRef: gitRef.optional(),
  /** Isolated only: new branch name, or the existing branch when `useExistingBranch`. */
  branch: gitRef.optional(),
  useExistingBranch: z.boolean().optional()
})

const none = z.undefined()

export const requestSchemas = {
  'app.info': none,
  'projects.list': none,
  'projects.open': none,
  'projects.remove': z.object({ projectId: id }),
  'projects.touch': z.object({ projectId: id }),
  'workspaces.list': z.object({ projectId: id }),
  'workspaces.suggestName': z.object({ projectId: id }),
  'workspaces.create': createWorkspaceSchema,
  'workspaces.delete': z.object({ workspaceId: id, force: z.boolean().optional() }),
  'clis.list': z.object({ refresh: z.boolean().optional() }).optional(),
  'agents.list': z.object({ workspaceId: id }),
  'agents.open': z.object({
    workspaceId: id,
    cliId: id,
    placement: z.object({ targetPaneId: id, side }).optional()
  }),
  'agents.close': z.object({ instanceId: id }),
  'agents.restart': z.object({ instanceId: id }),
  'agents.applyPreset': z.object({ workspaceId: id, presetId: id }),
  'terminal.write': z.object({ instanceId: id, data: z.string().max(1_000_000) }),
  'terminal.resize': z.object({
    instanceId: id,
    cols: z.number().int().min(2).max(1000),
    rows: z.number().int().min(2).max(1000)
  }),
  'terminal.snapshot': z.object({ instanceId: id }),
  'layout.get': z.object({ workspaceId: id }),
  'layout.apply': z.object({ workspaceId: id, operation: layoutOperationSchema }),
  'presets.list': none,
  'presets.save': presetInputSchema,
  'presets.delete': z.object({ presetId: id }),
  'kanban.board': z.object({ projectId: id }),
  'settings.get': none,
  'settings.update': z
    .object({
      theme: z.enum(['bronze', 'silver']),
      autoCheckUpdates: z.boolean(),
      agentTools: z.boolean()
    })
    .partial(),
  'updates.status': none,
  'updates.check': none,
  'updates.download': none,
  'updates.install': none,
  /** Reveals a known project/workspace folder in the OS file manager — never an arbitrary path. */
  'system.revealPath': z.object({ projectId: id.optional(), workspaceId: id.optional() }),
  'clipboard.readText': none,
  'clipboard.writeText': z.object({ text: z.string().max(5_000_000) }),
  /** The right-sidebar shell for a Workspace (or a Project's folder). Returns its terminal id. */
  'shell.open': z.object({ workspaceId: id.optional(), projectId: id.optional() }),
  'shell.restart': z.object({ id }),
  'shell.close': z.object({ id }),
  'extensions.scan': z.object({ projectId: id.optional() }),
  /** Paths must come from the last scan; main re-validates. */
  'extensions.shareSkill': z.object({ path: z.string().min(1).max(1000) }),
  'extensions.revealSkill': z.object({ path: z.string().min(1).max(1000) }),
  'chat.clis': none,
  'chat.list': none,
  'chat.get': z.object({ chatId: id }),
  'chat.create': z.object({ projectId: id.optional() }),
  'chat.update': z.object({
    chatId: id,
    cliId: id.optional(),
    projectId: z.union([id, z.literal('')]).optional(),
    // Model ids like "opencode-go/kimi-k2.7-code" or "sonnet[1m]"; never shell syntax.
    model: z.string().max(200).regex(/^[\w.:/@[\]-]*$/).optional(),
    effort: z.string().max(40).regex(/^[\w-]*$/).optional(),
    autoApprove: z.boolean().optional(),
    title: z.string().max(200).optional()
  }),
  'chat.delete': z.object({ chatId: id }),
  'chat.send': z.object({ chatId: id, text: z.string().min(1).max(100_000) }),
  'chat.stop': z.object({ chatId: id }),
  'chat.catalog': z.object({ cliId: id, refresh: z.boolean().optional() }),
  'git.info': z.object({ projectId: id }),
  'git.validateBranch': z.object({ projectId: id, name: z.string().max(200) }),
  /** Initializes Git in a project folder; `commit` also records an initial commit of its files. */
  'git.init': z.object({ projectId: id, commit: z.boolean() }),
  'workspaces.gitStatus': z.object({ workspaceId: id }),
  'workspaces.repair': z.object({ workspaceId: id }),
  'github.status': z.object({ projectId: id }),
  'github.pullRequests': z.object({ projectId: id }),
  'github.issues': z.object({ projectId: id }),
  'github.createPullRequest': z.object({ workspaceId: id, draft: z.boolean().optional() })
} as const

export interface AppInfo {
  platform: 'win32' | 'darwin' | 'linux'
  version: string
  /** False when the hook server failed to start; status falls back to heuristics. */
  hooksAvailable: boolean
  /** Unpackaged development build (shows the DEV badge). */
  isDev: boolean
}

export interface TerminalSnapshot {
  data: string
  /** Output offset the snapshot ends at; live chunks before it are already included. */
  end: number
}

export interface DeleteWorkspaceResult {
  /** Set when the local branch was kept because it has unmerged commits. */
  keptBranch?: string
}

export interface ResponseMap {
  'app.info': AppInfo
  'projects.list': Project[]
  'projects.open': Project | null
  'projects.remove': void
  'projects.touch': Project
  'workspaces.list': WorkspaceView[]
  'workspaces.suggestName': string
  'workspaces.create': WorkspaceView
  'workspaces.delete': DeleteWorkspaceResult
  'clis.list': CliDescriptor[]
  'agents.list': CliInstanceView[]
  /** The new agent plus the resulting layout, so the UI can show the pane without another round trip. */
  'agents.open': { agent: CliInstanceView; layout: LayoutNode | null }
  'agents.close': LayoutNode | null
  'agents.restart': void
  'agents.applyPreset': void
  'terminal.write': void
  'terminal.resize': void
  'terminal.snapshot': TerminalSnapshot
  'layout.get': LayoutNode | null
  'layout.apply': LayoutNode | null
  'presets.list': AgentPreset[]
  'presets.save': AgentPreset
  'presets.delete': void
  'kanban.board': KanbanBoard
  'settings.get': AppSettings
  'settings.update': AppSettings
  'updates.status': UpdateStatus
  'updates.check': UpdateStatus
  'updates.download': UpdateStatus
  'updates.install': void
  'system.revealPath': void
  'clipboard.readText': string
  'clipboard.writeText': void
  'shell.open': { id: string; cwd: string }
  'shell.restart': void
  'shell.close': void
  'extensions.scan': ExtensionsInventory
  'extensions.shareSkill': { path: string }
  'extensions.revealSkill': void
  'chat.clis': string[]
  'chat.list': ChatSummary[]
  'chat.get': ChatSession & { running: boolean }
  'chat.create': ChatSession
  'chat.update': ChatSession
  'chat.delete': void
  'chat.send': void
  'chat.stop': void
  'chat.catalog': ChatCatalog
  'git.info': GitInfo
  'git.validateBranch': { problem: string | null }
  'git.init': Project
  'workspaces.gitStatus': GitStatusView | null
  'workspaces.repair': WorkspaceView
  'github.status': GithubStatus
  'github.pullRequests': PullRequest[]
  'github.issues': GithubIssue[]
  'github.createPullRequest': { url: string }
}

export interface GitStatusView {
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  changed: number
  untracked: number
}

export type Channel = keyof typeof requestSchemas
export type RequestOf<C extends Channel> = z.input<(typeof requestSchemas)[C]>
export type ResponseOf<C extends Channel> = ResponseMap[C]

export type StateTopic = 'projects' | 'workspaces' | 'agents' | 'presets' | 'layout' | 'settings' | 'chats'

export interface EventMap {
  'terminal.data': { instanceId: string; data: string; offset: number }
  'runtime.changed': { instanceId: string; projectId: string; workspaceId: string; runtime: CliRuntimeDetails }
  'state.changed': { topic: StateTopic; projectId?: string; workspaceId?: string }
  'app.notice': { level: 'info' | 'warning' | 'error'; message: string }
  'updates.changed': UpdateStatus
  /** Snapshot of the assistant message being streamed (or just finished). */
  'chat.event': { chatId: string; message: ChatMessage; summary: ChatSummary }
}

export type EventName = keyof EventMap

export const CHANNELS = Object.keys(requestSchemas) as Channel[]
export const EVENT_NAMES: EventName[] = ['terminal.data', 'runtime.changed', 'state.changed', 'app.notice', 'updates.changed', 'chat.event']

/** Prefix keeping Hiveory IPC channels distinct from anything else on the bus. */
export const IPC_PREFIX = 'hiveory:'
