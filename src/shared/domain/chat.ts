/** A model a chat CLI can use. */
export interface ChatModel {
  /** Value passed to the CLI's model flag; '' means the CLI's own default. */
  id: string
  label: string
  /** Provider/group heading (e.g. "opencode-go"); used for grouping and search. */
  group?: string
  /** Effort/thinking levels this model accepts. Absent or empty = no effort picker. */
  efforts?: string[]
  defaultEffort?: string
  description?: string
  /** The CLI can run this model in its fast mode (Claude's Opus models, ADR 0058). */
  fast?: boolean
}

/** A slash command (or skill) the CLI offers in its prompt, as the CLI itself lists it (ADR 0058). */
export interface ChatCommand {
  name: string
  description?: string
  /** "<file>" style hint for what follows the command. */
  argumentHint?: string
}

export interface ChatCatalog {
  cliId: string
  models: ChatModel[]
  /** Set when model discovery failed; the default model still works. */
  error?: string
  /** The CLI can report its plan's usage limits (`chat.limits`, ADR 0055). */
  limits?: boolean
  /** Its slash commands and skills, for the composer's "/" menu (ADR 0058). */
  commands?: ChatCommand[]
  /** It has a read-only planning mode the composer can switch on (ADR 0058). */
  plan?: boolean
  /** It asks the user before using a tool, and asks its questions as cards (ADR 0073). */
  prompts?: boolean
}

/** One window of a CLI plan's usage limit (ADR 0055): "5-hour limit", "Weekly · Opus". */
export interface UsageWindow {
  id: string
  label: string
  /** Share used, 0–100; null when the CLI does not say. */
  usedPercent: number | null
  /** When the window starts over (ISO). */
  resetsAt?: string
}

/** A CLI's plan limits as the CLI itself reports them; Hiveory never reads its sign-in files. */
export interface UsageLimits {
  cliId: string
  windows: UsageWindow[]
  /** The plan, as the CLI names it ("max", "pro", "plus"). */
  plan?: string
  /** Why there are no windows (an API key has no plan limits, not signed in…). */
  note?: string
  checkedAt: string
}

export type ChatPart =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; id: string; name: string; detail?: string; output?: string; status: 'running' | 'done' | 'error' }

/** One step of the agent's own to-do list (Claude's TodoWrite, Codex's plan), newest list wins (ADR 0058). */
export interface ChatTask {
  text: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** How full the model's context window was at the end of a turn, as the CLI reports it (ADR 0058). */
export interface ChatUsage {
  /** Tokens in the context after the turn's last model call. */
  used: number
  /** The model's context window, when the CLI says. */
  window?: number
}

/**
 * The worktree before and after one turn (ADR 0058): Git trees written aside from the user's index
 * and branches, so the turn's own changes can be listed and undone.
 */
export interface TurnCheckpoint {
  before: string
  after?: string
  files?: number
  additions?: number
  deletions?: number
  /** The turn's changes were undone. */
  reverted?: boolean
}

/** A file sent with a message: pasted images/video, dropped files, or long pasted text saved to a file. */
export interface ChatAttachment {
  name: string
  /** Absolute path the CLI reads. Main only accepts paths it registered itself. */
  path: string
  kind: 'image' | 'video' | 'text' | 'file'
  size: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  parts: ChatPart[]
  attachments?: ChatAttachment[]
  createdAt: string
  /** Assistant turn still streaming. */
  streaming?: boolean
  error?: string
  /** The agent's to-do list as this turn left it. */
  tasks?: ChatTask[]
  usage?: ChatUsage
  /** Assistant turns in a Git worktree: what the turn changed. */
  checkpoint?: TurnCheckpoint
}

export interface ChatSession {
  id: string
  title: string
  projectId?: string
  /** The Worktree of `projectId` it works in (ADR 0055); absent = the Workspace's own folder. */
  workspaceId?: string
  cwd: string
  /** Locked once the first message is sent (ADR 0012). */
  cliId?: string
  model?: string
  effort?: string
  autoApprove: boolean
  /** With `autoApprove` off: ask the user before each tool that changes something, instead of refusing it (ADR 0073). */
  ask?: boolean
  /** Plan mode: the CLI plans and answers without changing anything (ADR 0058). */
  plan?: boolean
  /** Fast mode, for models that have one (ADR 0058). */
  fast?: boolean
  /**
   * The CLI changed mid-conversation (ADR 0058): the next turn starts a new session on the new CLI with
   * the conversation so far as context, then it resumes as usual.
   */
  handoff?: boolean
  /** Set when this chat backs a Work agent shown in chat view; such chats stay out of the Chat list. */
  agentId?: string
  /** Messages typed while it was answering: each goes in as the next turn, in order (ADR 0031). */
  queued?: string[]
  /** The CLI's own session/thread id, used to resume the conversation. */
  providerSessionId?: string
  messages: ChatMessage[]
  createdAt: string
  updatedAt: string
}

export interface ChatSummary {
  id: string
  title: string
  cliId?: string
  projectId?: string
  workspaceId?: string
  updatedAt: string
  running: boolean
  /** The Work agent in chat view this chat backs. */
  agentId?: string
  /** Messages waiting for the current turn to end (ADR 0031). */
  queued?: string[]
  /** What the running turn waits on the user for, oldest first (ADR 0073). */
  prompts?: ChatPrompt[]
}

/** A chat's access (ADR 0064, 0073): refuse what changes things, ask first, or let it all run. */
export type ChatAccess = 'read' | 'ask' | 'full'

export const chatAccess = (chat: Pick<ChatSession, 'autoApprove' | 'ask'>): ChatAccess => (chat.autoApprove ? 'full' : chat.ask ? 'ask' : 'read')

/** One of the agent's questions, with the answers it offers (Claude's AskUserQuestion). */
export interface ChatQuestion {
  question: string
  header?: string
  multiSelect?: boolean
  options: Array<{ label: string; description?: string }>
}

/** Something a running turn waits on the user for (ADR 0073). */
export type ChatPrompt =
  /** A tool to allow or deny; `detail` is what it would do (a command, a file), `input` its arguments. */
  | { id: string; kind: 'permission'; tool: string; detail: string; input: string }
  | { id: string; kind: 'question'; questions: ChatQuestion[] }
  /** Leave plan mode and carry the plan out. */
  | { id: string; kind: 'plan'; plan: string }

/** The user's answer to a prompt. Questions: the question's text → the chosen labels or own words. */
export type ChatPromptAnswer =
  | { kind: 'permission'; allow: boolean }
  | { kind: 'question'; answers: Record<string, string> }
  | { kind: 'plan'; approve: boolean; feedback?: string }

/** CLIs that can drive a chat (headless mode with parseable output). Antigravity is excluded on purpose. */
export const CHAT_CLI_IDS = ['claude', 'codex', 'opencode', 'kilocode', 'gemini', 'qwen', 'grok', 'kimi', 'cursor', 'copilot'] as const
