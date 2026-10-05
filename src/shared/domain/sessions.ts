/**
 * An agent CLI's own conversation, read from the CLI's history on disk (the side
 * panel's Sessions tab). Hiveory only reads these files; it never changes them.
 */
export interface AgentSession {
  /** The CLI's session id (what its resume flag takes). */
  id: string
  cliId: string
  /** The CLI's own title for it, else the first thing the user asked. */
  title: string
  /** The last words in it: the user's prompt or the agent's reply. */
  preview?: { from: 'you' | 'agent'; text: string }
  /** Folder the session ran in. */
  cwd: string
  model?: string
  startedAt?: string
  updatedAt: string
}

export type SessionScope = 'workspace' | 'project' | 'all'

/** Session ids become a CLI argument: only plain ids (UUID-like) are accepted. */
export const SESSION_ID = /^[A-Za-z0-9-]{8,64}$/
