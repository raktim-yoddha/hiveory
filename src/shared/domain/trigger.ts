/**
 * Triggers (ADR 0028): an event in one of the user's connected apps (a new email, a GitHub issue…)
 * starts a run on a bot. Events reach Hiveory through Composio's webhook, delivered over Tailscale
 * Funnel to a loopback listener; each run is read-only and treats the event as untrusted data.
 */
export interface Trigger {
  id: string
  name: string
  botId: string
  /** What the bot does with each event. */
  prompt: string
  /** The connected app's Composio toolkit slug, and the account (ca_…) the event comes from. */
  appId: string
  accountId: string
  /** Composio's trigger type, e.g. GMAIL_NEW_GMAIL_MESSAGE, and its readable name. */
  triggerSlug: string
  triggerName: string
  /** The trigger type's settings (a repository, a label…), as Composio's schema asks. */
  config: Record<string, string | number | boolean>
  /** Composio's trigger instance (ti_…). */
  instanceId: string
  enabled: boolean
  lastEventAt?: string
  createdAt: string
  updatedAt: string
}

/** One field a trigger type asks for. */
export interface TriggerField {
  key: string
  label: string
  description?: string
  type: 'string' | 'number' | 'boolean'
  required: boolean
  default?: string | number | boolean
}

/** An event a connected app can start a run with. */
export interface TriggerType {
  slug: string
  name: string
  description: string
  fields: TriggerField[]
}

/** The public link events arrive by. */
export interface TriggerLinkStatus {
  state: 'off' | 'on' | 'error'
  /** The HTTPS address Composio delivers to, while on. */
  url?: string
  /** What went wrong, and what to do about it. */
  detail?: string
  /** A page that fixes it (e.g. allowing Funnel on the tailnet). */
  fixUrl?: string
  /** The Composio project already delivers webhooks somewhere else; Hiveory can take that over if the user says so. */
  conflict?: string
}

export const MAX_TRIGGER_NAME = 80
export const MAX_TRIGGER_PROMPT = 8000
/** Event data a run sees at most; the rest is cut. */
export const MAX_EVENT_CHARS = 8000
/** Runs one trigger may have going at once; more events wait for none and are logged as skipped. */
export const MAX_TRIGGER_RUNS = 3
