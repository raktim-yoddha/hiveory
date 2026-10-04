import { z } from 'zod'
import type {
  AgentPreset,
  CliDescriptor,
  CliInstanceView,
  CliRuntimeDetails,
  KanbanBoard,
  LayoutNode,
  Project,
  WorkspaceView
} from '../domain'

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
  z.object({
    type: z.literal('resize'),
    path: z.array(z.number().int().min(0).max(64)).max(32),
    ratios: z.array(z.number().positive().finite()).min(2).max(64)
  })
])

export const createWorkspaceSchema = z.object({
  projectId: id,
  /** `main` uses the project folder itself; `isolated` gets a linked worktree + branch. */
  kind: z.enum(['main', 'isolated']).default('isolated'),
  name: z.string().trim().min(1).max(60),
  association: z
    .object({ kind: z.enum(['issue', 'pull-request']), ref: z.string().trim().min(1).max(300) })
    .optional(),
  cliSelections: z.array(cliSelectionSchema).max(32),
  autoApprove: z.boolean()
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
  'kanban.board': z.object({ projectId: id })
} as const

export interface AppInfo {
  platform: 'win32' | 'darwin' | 'linux'
  version: string
  /** False when the hook server failed to start; status falls back to heuristics. */
  hooksAvailable: boolean
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
}

export type Channel = keyof typeof requestSchemas
export type RequestOf<C extends Channel> = z.input<(typeof requestSchemas)[C]>
export type ResponseOf<C extends Channel> = ResponseMap[C]

export type StateTopic = 'projects' | 'workspaces' | 'agents' | 'presets' | 'layout'

export interface EventMap {
  'terminal.data': { instanceId: string; data: string; offset: number }
  'runtime.changed': { instanceId: string; projectId: string; workspaceId: string; runtime: CliRuntimeDetails }
  'state.changed': { topic: StateTopic; projectId?: string; workspaceId?: string }
  'app.notice': { level: 'info' | 'warning' | 'error'; message: string }
}

export type EventName = keyof EventMap

export const CHANNELS = Object.keys(requestSchemas) as Channel[]
export const EVENT_NAMES: EventName[] = ['terminal.data', 'runtime.changed', 'state.changed', 'app.notice']

/** Prefix keeping Hiveory IPC channels distinct from anything else on the bus. */
export const IPC_PREFIX = 'hiveory:'
