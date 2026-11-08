import type { CodeHostId, TrackerId } from './integrations'

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

/** A chat CLI's model and reasoning effort; '' is the CLI's own default. */
export interface ChatChoice {
  model: string
  effort: string
}

/** Per-Workspace settings (ADR 0037). Every field is optional: absent means "the app's default". */
export interface ProjectSettings {
  /** Model and effort a new chat agent starts with, per chat CLI id. */
  chatDefaults?: Record<string, ChatChoice>
  /** Start of new worktree branch names (default "hiveory/"). */
  branchPrefix?: string
  /** Branch new worktrees start from (default: the repository's default branch). */
  baseRef?: string
  /** False: agents here never announce themselves (phone pushes). */
  alerts?: boolean
  /** True: listed first in the sidebar, the rail, the command palette and the phone (ADR 0060). */
  pinned?: boolean
  /** Commands run in a worktree's terminal by name: dev, test, lint… (ADR 0061). */
  scripts?: WorkspaceScript[]
  /** The Workspace's mark in the sidebar (ADR 0038); absent = a folder. */
  icon?: WorkspaceIcon
  /** Its color; absent = one picked from its id, so Workspaces differ from the start. */
  color?: WorkspaceColor
  /** Any color the user picked (#rrggbb), over `color` (ADR 0042). */
  customColor?: string
  /** An image instead of the icon: a small PNG data URL (ADR 0042). Shown over `emoji` and `icon`. */
  avatar?: string
  /** An emoji instead of the icon (ADR 0043); shown over `icon`. */
  emoji?: string
  /** Where its reviews come from (ADR 0040); absent = told by its origin remote, 'none' = off. */
  codeHost?: CodeHostId | 'none'
  /** Where its issues come from; absent = its code host's issues, 'none' = no issues. */
  issueSource?: TrackerId | 'none'
  /** The Jira project or Linear team key when `issueSource` names one. */
  trackerGroup?: string
}

/** A Workspace's named command (ADR 0061), run in a terminal of the worktree it is started in. */
export interface WorkspaceScript {
  name: string
  command: string
}

export const MAX_SCRIPTS = 20
export const MAX_SCRIPT_COMMAND = 2000
/** A script's name: short, readable, usable as a pane name. */
export const SCRIPT_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._:-]{0,39}$/
/** One line, no control characters: what is typed into the terminal is exactly what was saved. */
export const scriptCommandProblem = (command: string): string | null => {
  if (!command.trim()) return 'Enter the command to run.'
  if (command.length > MAX_SCRIPT_COMMAND) return 'That command is too long.'
  if ([...command].some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127)) return 'Use one line, without control characters.'
  return null
}

/** Marks a Workspace can show in the sidebar; the renderer maps each to an icon. */
// The product owner's set, in their order (ADR 0043), then the earlier ones a Workspace may already use.
export const WORKSPACE_ICONS = [
  'folder', 'code', 'terminal', 'bot', 'package', 'database', 'globe', 'server', 'cpu', 'layers',
  'braces', 'rocket', 'wrench', 'briefcase', 'building', 'palette', 'gauge', 'sparkles', 'shapes', 'box',
  'flask', 'book', 'phone'
] as const
export type WorkspaceIcon = (typeof WORKSPACE_ICONS)[number]

/** One emoji (with its modifiers and joiners), as a Workspace's mark. */
// Joiners (U+200D) and variation selectors (U+FE0F) are Emoji_Component.
export const EMOJI = /^[\p{Emoji}\p{Emoji_Component}]{1,16}$/u

/** A custom Workspace color: #rrggbb. */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i
/** An avatar's side in pixels, and its stored form (ADR 0042). */
export const AVATAR_PX = 96
export const AVATAR_DATA = /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/
export const MAX_AVATAR_CHARS = 80_000

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


export type ProjectSort = 'recent' | 'name'
