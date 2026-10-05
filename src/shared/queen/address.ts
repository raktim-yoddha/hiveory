import type { QueenAction, QueenContext, QueenParse } from './actions'
import { cliAliases, escapeRe, fold, NUMBER_WORDS } from './words'

/**
 * Talking to agents by name (ADR 0019): "codex run the tests", "Bruno, fix the
 * build", "everyone: commit your work", "tell all claude to stop and summarise".
 * The message is always the user's exact words. A name that matches nothing, or
 * more than one agent, becomes a question — never a guess.
 */

type Agent = QueenContext['agents'][number]

type Target =
  | { kind: 'agent'; name: string; petName: string }
  | { kind: 'cli'; name: string; cliId: string }
  /** Every agent here, or every agent of one CLI ("all codex"). Shells are never included. */
  | { kind: 'everyone'; name: string; cliId?: string }

const LEAD = /^\s*(?:(?:hey|hi|ok|okay)\s+)?(?:queen(?:\s+bee)?[\s,]+)?(?:please\s+)?/i
const EVERYONE = ['everyone', 'everybody', 'all agents', 'all of you', 'all of them', 'every agent', 'sab log', 'sabko', 'all']

/** Every way the start of a sentence can name a target, longest first so "claude code" beats "claude". */
function targets(ctx: QueenContext): Array<{ words: string[]; target: Target }> {
  const list: Array<{ words: string[]; target: Target }> = []
  for (const a of ctx.agents) list.push({ words: a.petName.toLowerCase().split(/\s+/), target: { kind: 'agent', name: a.petName, petName: a.petName } })
  for (const cli of ctx.clis) {
    for (const alias of cliAliases(cli)) {
      const words = alias.split(' ')
      list.push({ words, target: { kind: 'cli', name: cli.displayName, cliId: cli.id } })
      if (cli.kind !== 'shell') {
        for (const all of [['all'], ['every'], ['all', 'the']]) {
          list.push({ words: [...all, ...words], target: { kind: 'everyone', name: `every ${cli.displayName}`, cliId: cli.id } })
          list.push({ words: [...all, ...words.slice(0, -1), `${words.at(-1)}s`], target: { kind: 'everyone', name: `every ${cli.displayName}`, cliId: cli.id } })
        }
      }
    }
  }
  for (const e of EVERYONE) list.push({ words: e.split(' '), target: { kind: 'everyone', name: 'everyone' } })
  return list.sort((a, b) => b.words.length - a.words.length)
}

/** The target named at the very start of `text`, and the raw text after it. */
function leading(text: string, ctx: QueenContext): { target: Target; rest: string } | null {
  const body = text.replace(LEAD, '')
  for (const { words, target } of targets(ctx)) {
    const m = new RegExp(`^@?${words.map(escapeRe).join('[\\s_-]+')}(?=$|[\\s,:;.!?])`, 'iu').exec(body)
    if (m) return { target, rest: body.slice(m[0].length).replace(/^[\s,:;]+/, '') }
  }
  return null
}

/** Short status questions about the named target ("codex status", "Bruno, are you done?"). */
const STATUS_ONLY = /^(status|report|progress|update|updates|whats up|what are you doing|what you doing|how is it going|hows it going|how are you doing|are you done|done yet|you done|is it done|where are you)$/

/** The rest is only Queen Bee's own command words ("codex aur claude kholo"): a command, not a message. */
const COMMAND_WORDS = new Set(['open', 'close', 'show', 'go', 'restart', 'stop', 'focus', 'and', 'all', 'agent', 'agents', 'both', 'too', 'also', 'idle', 'working', 'waiting', 'busy', 'free', 'finished', 'everything', 'kuch', 'status'])
const isCommand = (rest: string, ctx: QueenContext): boolean => {
  const aliases = new Set(ctx.clis.flatMap(cliAliases).flatMap((a) => a.split(' ')))
  const words = fold(rest).split(' ').filter(Boolean)
  return words.length > 0 && words.some((w) => COMMAND_WORDS.has(w) && w !== 'and') && words.every((w) => COMMAND_WORDS.has(w) || aliases.has(w) || w in NUMBER_WORDS || /^\d+$/.test(w))
}

const ask = (text: string, choices?: Array<{ label: string; command: string }>): QueenParse => ({ kind: 'ask', question: { text, ...(choices?.length ? { choices } : {}) } })
const message = (agents: Agent[], text: string): QueenParse => ({ kind: 'actions', actions: agents.map((a): QueenAction => ({ type: 'message-agent', agentId: a.id, text })) })
const isShell = (ctx: QueenContext, cliId: string): boolean => ctx.clis.find((c) => c.id === cliId)?.kind === 'shell'

/** Sends `text` to whoever `target` names, asking when that is not exactly clear. */
function send(target: Target, text: string, ctx: QueenContext): QueenParse {
  const here = (a: Agent) => a.workspaceId === ctx.workspaceId
  if (target.kind === 'agent') {
    const named = ctx.agents.filter((a) => a.petName.toLowerCase() === target.petName.toLowerCase())
    const pick = named.filter(here).length === 1 ? named.filter(here) : named
    if (pick.length > 1) return ask(`There's more than one ${target.petName}.`)
    return message(pick, text)
  }
  if (target.kind === 'everyone') {
    const scope = ctx.agents.filter((a) => !isShell(ctx, a.cliId) && (!target.cliId || a.cliId === target.cliId))
    const chosen = ctx.workspaceId ? scope.filter(here) : scope
    if (!chosen.length) return ask(target.cliId ? `No ${target.name.replace(/^every /, '')} is open here.` : 'No agents are open here.')
    return message(chosen, text)
  }
  const ofCli = ctx.agents.filter((a) => a.cliId === target.cliId)
  const local = ofCli.filter(here)
  const pool = local.length ? local : ofCli
  if (pool.length === 1) return message(pool, text)
  if (pool.length > 1) {
    return ask(`Which ${target.name}?`, [
      ...pool.slice(0, 4).map((a) => ({ label: a.petName, command: `@${a.petName} ${text}` })),
      ...(isShell(ctx, target.cliId) ? [] : [{ label: `All ${pool.length}`, command: `@all ${target.cliId} ${text}` }])
    ])
  }
  if (!ctx.workspaceId) return ask(`No ${target.name} is open. Open a workspace first.`)
  return ask(`No ${target.name} is open here. Open one and send it?`, [{ label: `Open ${target.name} and send`, command: `open ${target.name} and send: ${text}` }])
}

/** What to do with the rest of a sentence that starts with a name. */
function addressed(target: Target, rest: string, ctx: QueenContext): QueenParse | null {
  const text = rest.replace(/^["“']|["”']$/g, '').trim()
  if (!text) return null
  // "codex status", "Bruno, are you done?": a question about the target, which the clause rules answer.
  if (STATUS_ONLY.test(fold(text).replace(/\b(the|it|you)\b\s*$/, '').trim()) || isCommand(text, ctx)) return null
  return send(target, text, ctx)
}

/** "codex run the tests", "Bruno: fix it", "@everyone commit". Null when the sentence doesn't start with a name. */
export function parseAddress(input: string, ctx: QueenContext): QueenParse | null {
  const lead = leading(input, ctx)
  return lead ? addressed(lead.target, lead.rest, ctx) : null
}

const TELL = /^\s*(?:(?:hey|hi|ok|okay)\s+)?(?:queen(?:\s+bee)?[\s,]+)?(?:please\s+)?(?:tell|ask|message|instruct|have|get|bolo|batao)\s+([\s\S]+)$/iu

/** "tell Bruno to run `pnpm test`", "ask codex: what changed?", "tell everyone to commit". */
export function parseMessage(input: string, ctx: QueenContext): QueenParse | null {
  const m = TELL.exec(input)
  if (!m) return null
  const lead = leading(m[1]!, ctx)
  if (!lead) return null
  const text = lead.rest.replace(/^(?:to|ko)\s+/i, '').replace(/^["“']|["”']$/g, '').trim()
  if (!text) return null
  return send(lead.target, text, ctx)
}

const OPEN_SEND = /^\s*(?:please\s+)?(?:open|start|launch|spin up)\s+(?:a\s+|an\s+|one\s+|new\s+)?([\s\S]+?)\s+and\s+(?:send|tell|ask|say|give)(?:\s+(?:it|him|her|them))?[\s,:]+(?:to\s+)?([\s\S]+)$/iu

/** "open codex and send: fix the login bug" — one new agent, then the message once it's ready. */
export function parseOpenAndSend(input: string, ctx: QueenContext): QueenParse | null {
  const m = OPEN_SEND.exec(input)
  if (!m) return null
  const name = fold(m[1]!)
  const cli = ctx.clis.find((c) => cliAliases(c).includes(name))
  if (!cli) return null
  const text = m[2]!.replace(/^["“']|["”']$/g, '').trim()
  if (!text) return null
  if (!ctx.projectId || !ctx.workspaceId) return ask('Open a workspace first, then I can start it there.')
  return { kind: 'actions', actions: [{ type: 'open-and-message', cliId: cli.id, workspaceId: ctx.workspaceId, projectId: ctx.projectId, text }] }
}
