/**
 * Bot approvals (ADR 0029): before a bot acts in your apps, Hiveory may stop and ask. Every app and MCP
 * tool call of a bot's thread goes through Hiveory's own MCP server, so the check holds whatever the
 * engine, its permission mode or the prompt says.
 */

/** changes: ask before anything that changes or sends · sends: ask before it sends or posts as you · never: don't ask. */
export const APPROVAL_LEVELS = ['changes', 'sends', 'never'] as const
export type ApprovalLevel = (typeof APPROVAL_LEVELS)[number]
export const DEFAULT_APPROVAL_LEVEL: ApprovalLevel = 'sends'

/** read: only looks · change: changes something in an app · send: speaks for the user, or runs code that could. */
export type ToolRisk = 'read' | 'change' | 'send'

/** A bot's call waiting on the user. */
export interface ApprovalRequest {
  id: string
  botId: string
  threadId: string
  /** The tool as the bot called it (e.g. `composio_GMAIL_SEND_EMAIL`), or the app actions inside it. */
  tool: string
  risk: Exclude<ToolRisk, 'read'>
  /** The call's arguments as text, cut short: shown as plain text, never run. */
  detail: string
  createdAt: string
}

/** Unanswered requests are declined after this long, so an unattended run never hangs. */
export const APPROVAL_TIMEOUT_MS = 15 * 60_000
export const MAX_APPROVAL_DETAIL = 1500

const READ = new Set(['get', 'list', 'search', 'fetch', 'find', 'read', 'retrieve', 'query', 'view', 'describe', 'check', 'count', 'lookup', 'preview', 'show', 'peek', 'download', 'summarize', 'whoami'])
const SEND = new Set(['send', 'post', 'reply', 'forward', 'publish', 'tweet', 'retweet', 'comment', 'invite', 'share', 'broadcast', 'notify', 'dm'])
/** Runs arbitrary code or commands: it could do anything, sending included. */
const CODE = new Set(['bash', 'shell', 'workbench', 'command', 'exec', 'execute', 'eval', 'script'])

const RANK: Record<ToolRisk, number> = { read: 0, change: 1, send: 2 }

/** The app actions a meta tool carries (Composio's multi-execute: `{ tools: [{ tool_slug }] }`). */
const innerSlugs = (args: unknown): string[] => {
  const tools = (args as { tools?: unknown } | null)?.tools
  return Array.isArray(tools) ? tools.map((t) => (t as { tool_slug?: unknown })?.tool_slug).filter((s): s is string => typeof s === 'string') : []
}

/**
 * How risky a call is, from its name: the first verb-like word decides (`GET_POST` reads, `CHAT_POST_MESSAGE`
 * sends). A name with none of them changes something. A call wrapping app actions is as risky as the riskiest.
 */
export function toolRisk(name: string, args?: unknown): ToolRisk {
  const inner = innerSlugs(args)
  if (inner.length) return inner.map((s) => toolRisk(s)).reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'read')
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
  for (const word of words) {
    if (SEND.has(word) || CODE.has(word)) return 'send'
    if (READ.has(word)) return 'read'
  }
  return 'change'
}

/** What happens to a call: it goes ahead, waits for the user, or is refused (a read-only run never changes anything). */
export function approvalGate(level: ApprovalLevel, risk: ToolRisk, readOnly: boolean): 'allow' | 'ask' | 'refuse' {
  if (risk === 'read') return 'allow'
  if (readOnly) return 'refuse'
  if (level === 'never') return 'allow'
  if (level === 'changes') return 'ask'
  return risk === 'send' ? 'ask' : 'allow'
}

/** The arguments as the user reads them: inner app actions first, cut to a readable length. */
export function approvalDetail(args: unknown): string {
  const inner = (args as { tools?: unknown } | null)?.tools
  const text = JSON.stringify(Array.isArray(inner) ? inner : (args ?? {}), null, 2)
  return text.length > MAX_APPROVAL_DETAIL ? `${text.slice(0, MAX_APPROVAL_DETAIL)}…` : text
}

/** The tool's name for the request: the app actions inside a meta tool, or the tool itself. */
export const approvalTool = (name: string, args: unknown): string => innerSlugs(args).join(', ') || name
