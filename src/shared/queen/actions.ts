import type { CliStatus, ThemeId } from '../domain'
import type { SmallTalk } from './chat'

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
  | { type: 'set-mode'; mode: 'workspace' | 'bots' | 'chatspace' }
  | { type: 'side-panel'; open: boolean }
  | { type: 'open-panel-tab'; kind: 'browser' | 'explorer' }
  /** Status of agents: the current project (or every project from Home), every project with `everywhere`, one CLI with `cliId`. */
  | { type: 'report'; focus: 'all' | CliStatus; everywhere?: boolean; cliId?: string }
  /** One agent up close: status, what it is doing, the last words on its screen. */
  | { type: 'agent-detail'; agentId: string }
  /** Stops what an agent is doing without closing it (Esc for agent CLIs, Ctrl+C for shells). */
  | { type: 'interrupt-agent'; agentId: string }
  /** Starts one agent of a CLI and, once it is ready, sends it a message. */
  | { type: 'open-and-message'; cliId: string; workspaceId: string; projectId: string; text: string }
  /** Jumps to the agent that has waited on you the longest. */
  | { type: 'focus-waiting' }
  | { type: 'set-theme'; theme: ThemeId }
  /** Talkback on or off. */
  | { type: 'speak'; on: boolean }
  | { type: 'create-workspace'; name: string; projectId: string }
  /** What she can do. */
  | { type: 'help' }
  /** Things she's learned: saves a note the user asked her to remember (shown as "Noted: …"). */
  | { type: 'remember'; text: string }
  /** Removes every note that contains the text. */
  | { type: 'forget'; text: string }
  /** Reads her notes back. */
  | { type: 'recall' }
  /** Small talk ("hi", "thanks", "who are you"): she answers in her personality; nothing runs. */
  | { type: 'chat'; topic: SmallTalk }

/** How each top-level mode is named to the user. */
export const MODE_LABEL = { workspace: 'Work', bots: 'Bots', chatspace: 'Chat' } as const

/** The plain snapshot of app state the parser reads. Built by the renderer from its stores. */
export interface QueenContext {
  mode: 'workspace' | 'bots' | 'chatspace'
  /** The current page; on Settings, the page it returns to. */
  projectId?: string
  workspaceId?: string
  projects: Array<{ id: string; name: string }>
  /** Workspaces of the current project. */
  workspaces: Array<{ id: string; name: string; kind: 'main' | 'isolated' }>
  /** Workspaces of every other project, so "go to main" can ask which project's Main. Only navigation uses them. */
  otherWorkspaces?: Array<{ id: string; name: string; kind: 'main' | 'isolated'; projectId: string }>
  /** Agents of the current project (every workspace that has been loaded). */
  agents: Array<{ id: string; petName: string; cliId: string; workspaceId: string; status?: CliStatus }>
  /** Installed agent CLIs and terminals. */
  clis: Array<{ id: string; displayName: string; kind?: 'agent' | 'shell' }>
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
  /** `soft`: the rules did not understand a name; a model, when set up, gets to try before this is asked. */
  | { kind: 'ask'; question: QueenQuestion; soft?: boolean }
  /** Not a command the rules understand; a model brain (phase 2) takes these. */
  | { kind: 'unknown' }

/** Things she's learned: at most this many notes, each at most this long. */
export const MAX_NOTES = 50
export const MAX_NOTE_LENGTH = 200

/** Upper bound on agents one command may open. */
export const MAX_OPEN_PER_COMMAND = 8
