import type { CliStatus } from '../domain'

/** Settings sections Queen Bee can open (mirrors the renderer's Settings navigation). */
export const QUEEN_SETTINGS_SECTIONS = ['appearance', 'agents', 'browser', 'extensions', 'queen', 'updates', 'guide', 'about'] as const
export type QueenSettingsSection = (typeof QUEEN_SETTINGS_SECTIONS)[number]

/**
 * Everything Queen Bee can do: a closed set. The rule parser and (later) a model
 * both emit these; only the executor turns them into app operations, after
 * resolving every id against live state.
 */
export type QueenAction =
  | { type: 'open-agents'; cliId: string; count: number; workspaceId: string; projectId: string }
  | { type: 'close-agents'; agentIds: string[] }
  | { type: 'restart-agent'; agentId: string }
  | { type: 'focus-agent'; agentId: string; workspaceId: string; projectId: string }
  /** Types an instruction into an agent (terminal or chat) and submits it. */
  | { type: 'message-agent'; agentId: string; text: string }
  | { type: 'apply-preset'; presetId: string; workspaceId: string; projectId: string }
  | { type: 'navigate'; to: 'home' }
  | { type: 'navigate'; to: 'settings'; section: QueenSettingsSection }
  | { type: 'navigate'; to: 'project'; projectId: string }
  | { type: 'navigate'; to: 'workspace'; projectId: string; workspaceId: string }
  | { type: 'set-mode'; mode: 'workspace' | 'chatspace' }
  | { type: 'side-panel'; open: boolean }
  | { type: 'open-panel-tab'; kind: 'browser' | 'explorer' }
  | { type: 'report'; focus: 'all' | CliStatus }
  /** Things she's learned: saves a note the user asked her to remember (shown as "Noted: …"). */
  | { type: 'remember'; text: string }
  /** Removes every note that contains the text. */
  | { type: 'forget'; text: string }
  /** Reads her notes back. */
  | { type: 'recall' }

/** The plain snapshot of app state the parser reads. Built by the renderer from its stores. */
export interface QueenContext {
  mode: 'workspace' | 'chatspace'
  /** The current page; on Settings, the page it returns to. */
  projectId?: string
  workspaceId?: string
  projects: Array<{ id: string; name: string }>
  /** Workspaces of the current project. */
  workspaces: Array<{ id: string; name: string; kind: 'main' | 'isolated' }>
  /** Agents of the current project (every workspace that has been loaded). */
  agents: Array<{ id: string; petName: string; cliId: string; workspaceId: string; status?: CliStatus }>
  /** Installed agent CLIs and terminals. */
  clis: Array<{ id: string; displayName: string }>
  presets: Array<{ id: string; name: string }>
  /** A custom personality's name, so "Zara, open Codex" parses like "Queen, open Codex". */
  queenName?: string
}

/** A question back to the user: either free text or one of a few choices that re-run the command. */
export interface QueenQuestion {
  text: string
  choices?: Array<{ label: string; command: string }>
}

export type QueenParse =
  | { kind: 'actions'; actions: QueenAction[]; /** Needs a yes before it runs (closing agents). */ confirm?: string }
  | { kind: 'ask'; question: QueenQuestion }
  /** Not a command the rules understand; a model brain (phase 2) takes these. */
  | { kind: 'unknown' }

/** Things she's learned: at most this many notes, each at most this long. */
export const MAX_NOTES = 50
export const MAX_NOTE_LENGTH = 200

/** Upper bound on agents one command may open. */
export const MAX_OPEN_PER_COMMAND = 8
