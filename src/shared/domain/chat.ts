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
}

export interface ChatCatalog {
  cliId: string
  models: ChatModel[]
  /** Set when model discovery failed; the default model still works. */
  error?: string
}

export type ChatPart =
  | { kind: 'text'; text: string }
  | { kind: 'thinking'; text: string }
  | { kind: 'tool'; id: string; name: string; detail?: string; output?: string; status: 'running' | 'done' | 'error' }

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
}

export interface ChatSession {
  id: string
  title: string
  projectId?: string
  cwd: string
  /** Locked once the first message is sent (ADR 0012). */
  cliId?: string
  model?: string
  effort?: string
  autoApprove: boolean
  /** Set when this chat backs a Work agent shown in chat view; such chats stay out of the Chat list. */
  agentId?: string
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
  updatedAt: string
  running: boolean
  /** Backs a Work agent in chat view (never listed in Chat mode). */
  agentId?: string
}

/** CLIs that can drive a chat (headless mode with parseable output). Antigravity is excluded on purpose. */
export const CHAT_CLI_IDS = ['claude', 'codex', 'opencode', 'kilocode', 'gemini', 'qwen', 'grok', 'kimi', 'cursor', 'copilot'] as const
