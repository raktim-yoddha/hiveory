/** Where a project's files, git and agents live (ADR 0022). Absent = this computer. */
export interface HostRef {
  kind: 'ssh'
  /** An alias from ~/.ssh/config or user@host. */
  destination: string
  port?: number
}

/** One stable key per machine: 'local', or 'ssh:<destination>[:port]'. */
export const hostKey = (host?: HostRef): string => (host ? `ssh:${host.destination}${host.port ? `:${host.port}` : ''}` : 'local')

/** How a host is named to the user. */
export const hostLabel = (host?: HostRef): string => (host ? host.destination : 'This computer')

/**
 * The link to a remote host (ADR 0025): `reconnecting` while its terminals are
 * kept on the other side, `offline` once Hiveory gave up (the next use connects again).
 */
export type HostLinkStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'

export interface Project {
  id: string
  name: string
  /** Folder the user opened (on `host` when the project is remote). */
  path: string
  /** A remote machine reached over SSH; absent for projects on this computer. */
  host?: HostRef
  /** Git repository root, when the folder belongs to a repository. */
  repositoryRoot?: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
  /** Last real work here — an agent started a turn, an agent or workspace was created — for the sidebar order. */
  lastActiveAt?: string
  /** The Workspace's own settings (ADR 0037); absent fields follow the app's defaults. */
  settings?: ProjectSettings
}

/** How an agent shows: its CLI's own terminal, or Hiveory's chat view (ADR 0013). */
export type AgentView = 'terminal' | 'chat'

/** A chat CLI's model and reasoning effort; '' is the CLI's own default. */
export interface ChatChoice {
  model: string
  effort: string
}

/** Per-Workspace settings (ADR 0037). Every field is optional: absent means "the app's default". */
export interface ProjectSettings {
  /** How new agents open in every Worktree here (the "+" menu, the phone, new worktrees). */
  agentView?: AgentView
  /** Model and effort a new chat agent starts with, per chat CLI id. */
  chatDefaults?: Record<string, ChatChoice>
  /** Start of new worktree branch names (default "hiveory/"). */
  branchPrefix?: string
  /** Branch new worktrees start from (default: the repository's default branch). */
  baseRef?: string
  /** False: agents here never announce themselves (Queen Bee updates, phone pushes). */
  alerts?: boolean
  /** The Workspace's mark in the sidebar (ADR 0038); absent = a folder. */
  icon?: WorkspaceIcon
  /** Its color; absent = one picked from its id, so Workspaces differ from the start. */
  color?: WorkspaceColor
}

/** Marks a Workspace can show in the sidebar; the renderer maps each to an icon. */
export const WORKSPACE_ICONS = ['folder', 'code', 'globe', 'box', 'rocket', 'flask', 'book', 'server', 'phone', 'database', 'palette', 'bot'] as const
export type WorkspaceIcon = (typeof WORKSPACE_ICONS)[number]

/** Workspace colors, drawn from the theme (its accent and terminal colors), so every theme keeps them readable. */
export const WORKSPACE_COLORS = ['accent', 'blue', 'cyan', 'green', 'yellow', 'red', 'magenta', 'gray'] as const
export type WorkspaceColor = (typeof WORKSPACE_COLORS)[number]

/** A Workspace's color: its own, or a stable pick from its id. */
export const workspaceColor = (project: Pick<Project, 'id' | 'settings'>): WorkspaceColor => {
  if (project.settings?.color) return project.settings.color
  let hash = 0
  for (const ch of project.id) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  return WORKSPACE_COLORS[hash % WORKSPACE_COLORS.length]!
}

/** New worktree branches start with this unless a Workspace sets its own prefix. */
export const DEFAULT_BRANCH_PREFIX = 'hiveory/'

export const branchPrefixOf = (project?: Pick<Project, 'settings'>): string => project?.settings?.branchPrefix ?? DEFAULT_BRANCH_PREFIX

/**
 * Whether a new agent opens in chat view: the Workspace's setting when it has one, otherwise the
 * Worktree's own (chosen when it was created), otherwise the app's (Settings › Agents, ADR 0038).
 * The "+" menu and the phone start from this.
 */
export const opensAsChat = (project: Pick<Project, 'settings'> | undefined, worktree: { chatUi?: boolean } | undefined, appDefault = false): boolean =>
  project?.settings?.agentView ? project.settings.agentView === 'chat' : (worktree?.chatUi ?? appDefault)

export type ProjectSort = 'recent' | 'name'
