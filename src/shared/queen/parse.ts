import { THEMES, type ThemeId } from '../domain/settings'
import { MAX_NOTE_LENGTH, MAX_OPEN_PER_COMMAND, type QueenAction, type QueenContext, type QueenParse, type QueenSettingsSection } from './actions'
import { parseAddress, parseMessage, parseOpenAndSend } from './address'
import { parseSmallTalk } from './chat'
import { CLOSE_VERBS, cliAliases, clauses, fold, GO_VERBS, hasWord, norm, NUMBER_WORDS, OPEN_VERBS, RESTART_VERBS, STOP_VERBS } from './words'

/**
 * Tier 0 of Queen Bee: a rule parser for the commands people actually say. It
 * needs no model, answers in well under a millisecond, and never guesses: an
 * unknown or ambiguous name becomes a question, anything else becomes
 * "unknown" for the model tier.
 */


/** The CLIs named in a clause, in order, each with the count written before it. */
const findClis = (clause: string, ctx: QueenContext): Array<{ cliId: string; count: number; name: string }> => {
  const tokens = clause.split(' ')
  const aliases = ctx.clis.flatMap((cli) => cliAliases(cli).map((alias) => ({ cli, alias, words: alias.split(' ') })))
  aliases.sort((a, b) => b.words.length - a.words.length)
  const found: Array<{ cliId: string; count: number; name: string }> = []
  let pending: number | null = null
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!
    const n = /^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token]
    if (n !== undefined) {
      pending = n
      continue
    }
    const hit = aliases.find((a) => a.words.every((w, k) => tokens[i + k] === w || tokens[i + k] === `${w}s`))
    if (!hit) continue
    found.push({ cliId: hit.cli.id, count: pending ?? 1, name: hit.cli.displayName })
    pending = null
    i += hit.words.length - 1
  }
  return found
}

/** Agents whose pet name appears in the clause; current workspace first. */
const findAgents = (clause: string, ctx: QueenContext): QueenContext['agents'] => {
  const named = ctx.agents.filter((a) => hasWord(clause, norm(a.petName)))
  return [...named].sort((a, b) => Number(b.workspaceId === ctx.workspaceId) - Number(a.workspaceId === ctx.workspaceId))
}

type Match<T> = { one: T } | { many: T[] } | null

/** Exact name first, then a unique prefix or substring. */
const matchName = <T extends { name: string }>(wanted: string, items: T[]): Match<T> => {
  const w = norm(wanted)
  if (!w) return null
  const exact = items.filter((i) => norm(i.name) === w)
  if (exact.length === 1) return { one: exact[0]! }
  const loose = items.filter((i) => norm(i.name).startsWith(w) || norm(i.name).includes(w))
  if (loose.length === 1) return { one: loose[0]! }
  if (loose.length > 1) return { many: loose }
  return null
}

/** "… in feature-x" / "… on main": the named workspace of the current project. */
const targetWorkspace = (clause: string, ctx: QueenContext): { id: string } | { ask: QueenParse } | null => {
  const m = /\b(?:in|on|inside|into|at) (?:workspace )?(.+)$/.exec(clause)
  if (m) {
    const name = m[1]!.replace(/\b(workspace|branch)\b/g, '').trim()
    const found = name === 'main' ? ctx.workspaces.filter((w) => w.kind === 'main').map((w) => ({ ...w })) : null
    const match = found?.length === 1 ? { one: found[0]! } : matchName(name, ctx.workspaces)
    if (match && 'one' in match) return { id: match.one.id }
    const options = match && 'many' in match ? match.many : ctx.workspaces
    return {
      ask: {
        kind: 'ask',
        ...(match ? {} : { soft: true }),
        question: {
          text: match ? `Which workspace do you mean?` : `There's no workspace called "${name}".`,
          choices: options.slice(0, 4).map((w) => ({ label: w.name, command: `${clause.slice(0, m.index).trim()} in ${w.name}` }))
        }
      }
    }
  }
  return ctx.workspaceId ? { id: ctx.workspaceId } : null
}

type Workspace = QueenContext['workspaces'][number] & { projectId: string }

/** "main" means the Main workspace; any other name matches exactly, then by a unique prefix or substring. */
const pickWorkspace = (name: string, list: Workspace[]): Match<Workspace> => {
  if (norm(name) === 'main') {
    const mains = list.filter((w) => w.kind === 'main')
    if (mains.length === 1) return { one: mains[0]! }
    if (mains.length > 1) return { many: mains }
  }
  return matchName(name, list)
}

/** "main of api", "feature-x in billing": a workspace qualified by its project. */
const QUALIFIED = /^(.+?) (?:of|in|from|on|for) (.+)$/

/**
 * Where "go to <name>" leads. The current project's workspace wins (she expects you
 * mean the project you're in), then a project by that name, then a workspace in
 * another project. A name several projects share ("main" from Home) is a question:
 * which project's?
 */
function findPlace(target: string, ctx: QueenContext, projectOnly: boolean): { navigate: QueenAction } | { ask: QueenParse } | null {
  const here: Workspace[] = ctx.projectId ? ctx.workspaces.map((w) => ({ ...w, projectId: ctx.projectId! })) : []
  const others: Workspace[] = ctx.otherWorkspaces ?? []
  const projectName = (id: string) => ctx.projects.find((p) => p.id === id)?.name ?? 'another project'
  const go = (w: Workspace) => ({ navigate: { type: 'navigate', to: 'workspace', projectId: w.projectId, workspaceId: w.id } as QueenAction })
  const choose = (list: Workspace[], text: string) => ({
    ask: {
      kind: 'ask',
      question: { text, choices: list.slice(0, 4).map((w) => ({ label: `${projectName(w.projectId)} · ${w.name}`, command: `go to ${w.name} of ${projectName(w.projectId)}` })) }
    } as QueenParse
  })

  const qualified = projectOnly ? null : QUALIFIED.exec(target)
  if (qualified) {
    const project = matchName(qualified[2]!, ctx.projects)
    if (project && 'one' in project) {
      const match = pickWorkspace(qualified[1]!, [...here, ...others].filter((w) => w.projectId === project.one.id))
      if (match && 'one' in match) return go(match.one)
      if (match && 'many' in match) return choose(match.many, 'Which workspace?')
      return { ask: { kind: 'ask', soft: true, question: { text: `${project.one.name} has no workspace called "${qualified[1]}".` } } }
    }
  }
  if (!projectOnly) {
    const match = pickWorkspace(target, here)
    if (match && 'one' in match) return go(match.one)
    if (match && 'many' in match) return choose(match.many, 'Which workspace?')
  }
  const project = matchName(target, ctx.projects)
  if (project && 'one' in project) return { navigate: { type: 'navigate', to: 'project', projectId: project.one.id } }
  if (project && 'many' in project) {
    return { ask: { kind: 'ask', question: { text: 'Which project?', choices: project.many.slice(0, 4).map((p) => ({ label: p.name, command: `go ${p.name} project` })) } } }
  }
  if (projectOnly) return null
  const elsewhere = pickWorkspace(target, others)
  if (elsewhere && 'one' in elsewhere) return go(elsewhere.one)
  if (elsewhere && 'many' in elsewhere) return choose(elsewhere.many, norm(target) === 'main' ? "Which project's Main?" : `Which project's ${target}?`)
  return null
}

const SETTINGS_KEYWORDS: Array<[RegExp, QueenSettingsSection]> = [
  [/\b(appearance|theme|themes|wallpaper|colou?rs?|transparency|look)\b/, 'appearance'],
  [/\b(queen|personality|persona|voice|assistant)\b/, 'queen'],
  [/\b(agents?|clis?)\b/, 'agents'],
  [/\b(browser|cookies|profiles?)\b/, 'browser'],
  [/\b(extensions?|skills?|mcp|plugins?|servers?)\b/, 'extensions'],
  [/\b(updates?|upgrade)\b/, 'updates'],
  [/\b(guide|help|docs|tutorial)\b/, 'guide'],
  [/\b(about|version)\b/, 'about']
]

const VERB_WORDS = /^(open|close|show|go|restart|stop)$/

const STATUS_WORDS =
  /\b(status|report|summary|summarize|progress|overview|update me|catch me up|whats (left|done|happening|going on|up|pending)|what is (left|done|happening|pending)|who(s| is) (waiting|working|idle|stuck|free|busy)|anyone (waiting|stuck)|any agents? (waiting|stuck|working|idle)|how are (agents|things|we doing)|what are (agents|they|all agents) doing|stuck)\b/
/** Questions about one agent: "what is Bruno doing", "is Bruno done", "how's Bruno". */
const DETAIL_WORDS = /\b(doing|up to|working on|done|finished|stuck|status|how is|hows|saying|said|say|output|screen|progress|busy|free)\b/
const EVERYWHERE = /\b(everything|everywhere|all projects|every project|across projects|overall|whole app)\b/

const parseClause = (sentence: string, ctx: QueenContext, previousVerb: string | null): { result: QueenParse; verb: string | null } => {
  // Verb-last word order (Hindi, "settings show"): bring the verb to the front.
  const words = sentence.split(' ')
  const clause = words.length > 1 && VERB_WORDS.test(words.at(-1)!) && !VERB_WORDS.test(words[0]!) ? [words.at(-1)!, ...words.slice(0, -1)].join(' ') : sentence
  const done = (actions: QueenAction[], verb: string | null = null): { result: QueenParse; verb: string | null } => ({ result: { kind: 'actions', actions }, verb })
  const ask = (text: string, choices?: Array<{ label: string; command: string }>) => ({ result: { kind: 'ask', question: { text, choices } } as QueenParse, verb: null })
  /** A question because a name wasn't understood: a model may understand it. */
  const soft = (text: string, choices?: Array<{ label: string; command: string }>) => ({ result: { kind: 'ask', question: { text, choices }, soft: true } as QueenParse, verb: null })

  // "take me to whoever needs me", "next": the agent that has waited longest.
  if (/^(go|focus|open)\b.*\b(waiting|needs me|need me|blocked)\b/.test(clause) || /^(next|next one|next agent|next waiting( agent)?)$/.test(clause)) {
    return done([{ type: 'focus-waiting' }])
  }

  // One agent up close: "what is Bruno doing", "is Bruno done", "Bruno status".
  const named = findAgents(clause, ctx)
  if (named.length === 1 && DETAIL_WORDS.test(clause) && !/^(close|restart|stop|open|go)\b/.test(clause)) return done([{ type: 'agent-detail', agentId: named[0]!.id }])

  // Reports: anything asking how things stand — here, everywhere, or for one CLI ("how is codex doing").
  const askedCli = findClis(clause, ctx)
  const aboutCli = askedCli.length === 1 && DETAIL_WORDS.test(clause) && !/^(close|restart|stop|open|go|show)\b/.test(clause)
  if (STATUS_WORDS.test(clause) || aboutCli || (EVERYWHERE.test(clause) && /\b(status|doing|happening|going on)\b/.test(clause))) {
    const focus = /\b(waiting|stuck|blocked|need me|needs me)\b/.test(clause)
      ? 'waiting-for-you'
      : /\b(working|busy)\b/.test(clause)
        ? 'working'
        : /\b(idle|free)\b/.test(clause)
          ? 'idle'
          : 'all'
    const cli = askedCli
    // A CLI with exactly one agent here: that agent up close.
    if (cli.length === 1) {
      const ofCli = ctx.agents.filter((a) => a.cliId === cli[0]!.cliId && (!ctx.workspaceId || a.workspaceId === ctx.workspaceId))
      if (ofCli.length === 1 && focus === 'all') return done([{ type: 'agent-detail', agentId: ofCli[0]!.id }])
    }
    return done([{ type: 'report', focus, ...(EVERYWHERE.test(clause) ? { everywhere: true } : {}), ...(cli.length === 1 ? { cliId: cli[0]!.cliId } : {}) }])
  }

  // Mode.
  if (/^(go |open |show )?(chat|chats|chat mode|chatspace)$/.test(clause)) return done([{ type: 'set-mode', mode: 'chatspace' }])
  if (/^(go |open |show )?(work|work mode|workspace mode|terminals)$/.test(clause)) return done([{ type: 'set-mode', mode: 'workspace' }])
  if (/^(go |open |show )?(bots|bots mode|my bots|the bots)$/.test(clause)) return done([{ type: 'set-mode', mode: 'bots' }])
  if (/^(go )?(home|home page|start page)$/.test(clause)) return done([{ type: 'navigate', to: 'home' }])

  // Settings.
  if (/\b(settings?|preferences|configure|config)\b/.test(clause)) {
    const section = SETTINGS_KEYWORDS.find(([re]) => re.test(clause.replace(/\b(settings?|preferences|configure|config)\b/g, '')))?.[1] ?? 'appearance'
    return done([{ type: 'navigate', to: 'settings', section }])
  }

  // Side panel and its tabs.
  if (/\bside panel\b/.test(clause)) return done([{ type: 'side-panel', open: !/^(close|hide|collapse|dismiss)\b/.test(clause) }])
  if (/^(open|show|go|start|launch|add)\b.*\b(browser|web browser)\b/.test(clause)) return done([{ type: 'open-panel-tab', kind: 'browser' }])
  if (/^(open|show|go|add)\b.*\bexplorer\b/.test(clause)) return done([{ type: 'open-panel-tab', kind: 'explorer' }])

  // Presets.
  if (/\bpresets?\b/.test(clause)) {
    const name = clause.replace(/\b(load|apply|use|run|open|start|preset|presets)\b/g, '').replace(/\b(in|on) .+$/, '').trim()
    const match = matchName(name, ctx.presets)
    if (!match || 'many' in match) {
      return (match ? ask : soft)(match ? 'Which preset?' : name ? `There's no preset called "${name}".` : 'Which preset?', (match && 'many' in match ? match.many : ctx.presets).slice(0, 4).map((p) => ({ label: p.name, command: `load preset ${p.name}` })))
    }
    const ws = targetWorkspace(clause, ctx)
    if (!ws) return ask('Open a workspace first, then load the preset.')
    if ('ask' in ws) return { result: ws.ask, verb: null }
    return done([{ type: 'apply-preset', presetId: match.one.id, workspaceId: ws.id, projectId: ctx.projectId! }])
  }

  const verb = STOP_VERBS.test(clause)
    ? 'stop'
    : CLOSE_VERBS.test(clause)
      ? 'close'
      : RESTART_VERBS.test(clause)
        ? 'restart'
        : OPEN_VERBS.test(clause)
          ? 'open'
          : GO_VERBS.test(clause)
            ? 'go'
            : previousVerb
  const agents = named

  // "close idle agents", "close all codex", "close every finished agent".
  const many = (): QueenContext['agents'] => {
    const ofCli = findClis(clause, ctx)
    const status = /\b(idle|finished|done|free)\b/.test(clause) ? 'idle' : /\b(working|busy)\b/.test(clause) ? 'working' : /\b(waiting|stuck|blocked)\b/.test(clause) ? 'waiting-for-you' : null
    if (!/\b(all|every|everyone|everything|idle|finished|done|free)\b/.test(clause) && !ofCli.length) return []
    // Plain shells are only included when named ("close powershell"): they are not agents.
    const shell = (cliId: string) => ctx.clis.find((c) => c.id === cliId)?.kind === 'shell'
    return ctx.agents.filter(
      (a) =>
        a.workspaceId === ctx.workspaceId &&
        (ofCli.length ? ofCli.some((c) => c.cliId === a.cliId) : !shell(a.cliId)) &&
        (!status || a.status === status)
    )
  }

  if (verb === 'stop') {
    const targets = agents.length ? agents : many()
    if (!targets.length) {
      const busy = ctx.agents.filter((a) => a.workspaceId === ctx.workspaceId && a.status === 'working')
      return soft(busy.length ? 'Which agent should I stop?' : 'No agent is working here.', busy.slice(0, 4).map((a) => ({ label: a.petName, command: `stop ${a.petName}` })))
    }
    return done(targets.map((a) => ({ type: 'interrupt-agent', agentId: a.id })), 'stop')
  }

  if (verb === 'close') {
    const everyone = /\b(all|every|everyone|everything|idle|finished|free)\b/.test(clause)
    const targets = agents.length ? agents : everyone || findClis(clause, ctx).length > 0 ? many() : []
    if (!targets.length) {
      const here = ctx.agents.filter((a) => a.workspaceId === ctx.workspaceId)
      return soft(here.length ? 'Which agent should I close?' : 'There are no agents open here.', here.slice(0, 4).map((a) => ({ label: a.petName, command: `close ${a.petName}` })))
    }
    return done([{ type: 'close-agents', agentIds: targets.map((a) => a.id) }], 'close')
  }

  if (verb === 'restart') {
    if (agents.length !== 1) return (agents.length ? ask : soft)('Which agent should I restart?', ctx.agents.filter((a) => a.workspaceId === ctx.workspaceId).slice(0, 4).map((a) => ({ label: a.petName, command: `restart ${a.petName}` })))
    return done([{ type: 'restart-agent', agentId: agents[0]!.id }], 'restart')
  }

  // A named agent with a "show/go/open" verb: jump to its pane.
  if ((verb === 'go' || verb === 'open') && agents.length >= 1 && !findClis(clause, ctx).length) {
    const unique = agents.filter((a) => norm(a.petName) === norm(agents[0]!.petName))
    if (unique.length > 1) return ask(`There's more than one ${agents[0]!.petName}.`)
    const a = agents[0]!
    return done([{ type: 'focus-agent', agentId: a.id, workspaceId: a.workspaceId, projectId: ctx.projectId! }], verb)
  }

  if (verb === 'open' || verb === 'go') {
    const clis = findClis(clause, ctx)
    if (clis.length) {
      const total = clis.reduce((n, c) => n + c.count, 0)
      if (total > MAX_OPEN_PER_COMMAND) return ask(`That's ${total} agents. I open at most ${MAX_OPEN_PER_COMMAND} per command.`)
      if (!ctx.projectId) return ask('Open a project first.', ctx.projects.slice(0, 4).map((p) => ({ label: p.name, command: `go ${p.name}` })))
      const ws = targetWorkspace(clause, ctx)
      if (!ws) return ask('Which workspace should they open in?', ctx.workspaces.slice(0, 4).map((w) => ({ label: w.name, command: `${clause} in ${w.name}` })))
      if ('ask' in ws) return { result: ws.ask, verb: null }
      return done(clis.map((c) => ({ type: 'open-agents', cliId: c.cliId, count: c.count, workspaceId: ws.id, projectId: ctx.projectId! })), 'open')
    }
    // A workspace or project by name: "go to main", "main of api", "open the api project".
    const target = clause.replace(/^(go|show|open|focus|find|view|display|visit)\b/, '').replace(/\b(workspace|project)\b/g, '').trim()
    if (target) {
      const place = findPlace(target, ctx, /\bproject\b/.test(clause) && !QUALIFIED.test(target))
      if (place) return 'navigate' in place ? done([place.navigate], verb) : { result: place.ask, verb: null }
    }
    if (verb === 'open' && /\b(agents?|cli|terminal)\b/.test(clause)) {
      return soft('Which agent should I open?', ctx.clis.slice(0, 4).map((c) => ({ label: c.displayName, command: `open ${c.displayName}` })))
    }
  }

  return { result: { kind: 'unknown' }, verb: null }
}

const LEAD = String.raw`^\s*(?:(?:hey|hi|ok|okay)\s+)?(?:queen(?:\s+bee)?[\s,]+)?(?:please\s+)?`
/** "remember that I review with Claude": the note keeps the user's exact words. "remember to …" is a reminder, not a fact: not handled here. */
const REMEMBER = new RegExp(`${LEAD}(?:remember|note down|note|keep in mind|yaad rakho|yaad rakhna)(?:\\s+that)?[\\s,:]+(?!to\\b)([\\s\\S]+?)\\s*$`, 'iu')
const FORGET = new RegExp(`${LEAD}(?:forget|unlearn|bhool jao|bhul jao)(?:\\s+that)?(?:\\s+about)?[\\s,:]+([\\s\\S]+?)\\s*$`, 'iu')
const RECALL = /\b(what do you (know|remember) about me|what have you (learned|learnt|noted)|what did i ask you to remember|(show|list|read) (me )?(your|my) notes|your notes|things (you|youve) learned|kya yaad hai)\b/

function parseMemory(input: string): QueenParse | null {
  if (RECALL.test(norm(input))) return { kind: 'actions', actions: [{ type: 'recall' }] }
  const forget = FORGET.exec(input)
  if (forget) return { kind: 'actions', actions: [{ type: 'forget', text: forget[1]!.replace(/[.!]+$/, '').trim().slice(0, MAX_NOTE_LENGTH) }] }
  const remember = REMEMBER.exec(input)
  if (!remember) return null
  const text = remember[1]!.replace(/^["“']|["”']$/g, '').trim()
  if (!text) return null
  if (text.length > MAX_NOTE_LENGTH) return { kind: 'ask', question: { text: `Notes are at most ${MAX_NOTE_LENGTH} characters. Say it shorter?` } }
  return { kind: 'actions', actions: [{ type: 'remember', text }] }
}

const HELP = /^(help|what can you do|what do you do|what can i say|commands|show commands|list commands|how do i use you|how to use you|kya kar sakti ho|kya kya kar sakti ho|madad)$/
const MUTE = /^(mute|be quiet|quiet|shut up|stop talking|silence|no voice|voice off|talkback off|sound off|chup|chup raho)$/
const UNMUTE = /^(unmute|speak|talk|talk to me|speak up|voice on|talkback on|sound on|bolo|bol ke batao)$/
const THEME_WORDS = new Set(['go', 'use', 'set', 'change', 'apply', 'switch', 'to', 'theme', 'mode', 'color', 'colors', 'colour', 'colours', 'a', 'on', 'turn'])
const NEW_WORKSPACE =/^\s*(?:please\s+)?(?:create|new|make|add|start|open)\s+(?:a\s+)?(?:new\s+)?workspace\s+(?:called\s+|named\s+|for\s+)?["“']?([^"”']+?)["”']?\s*$/i

/** One-liners: help, talkback, theme, a new workspace. */
function parseQuick(input: string, ctx: QueenContext): QueenParse | null {
  const text = fold(input)
  // Filler-free and as said: "what can you do" must keep its "can you".
  const plain = norm(input).replace(/^(hey |hi |ok |okay )?(queen bee |queen )?(please )?/, '').replace(/ please$/, '')
  const is = (re: RegExp) => re.test(text) || re.test(plain)
  if (is(HELP)) return { kind: 'actions', actions: [{ type: 'help' }] }
  if (is(MUTE)) return { kind: 'actions', actions: [{ type: 'speak', on: false }] }
  if (is(UNMUTE)) return { kind: 'actions', actions: [{ type: 'speak', on: true }] }
  // "jade theme", "switch to the rose theme", "dark mode" — the whole sentence, nothing else in it.
  const words = text.split(' ').filter((w) => !THEME_WORDS.has(w))
  const theme = /\b(theme|mode|colou?rs?)\b/.test(text) && words.length === 1 ? THEMES.find((t) => t.id === words[0]) : undefined
  if (theme) return { kind: 'actions', actions: [{ type: 'set-theme', theme: theme.id as ThemeId }] }
  const ws = NEW_WORKSPACE.exec(input)
  if (ws) {
    if (!ctx.projectId) return { kind: 'ask', question: { text: 'Open a project first, then I can add a workspace to it.' } }
    return { kind: 'actions', actions: [{ type: 'create-workspace', name: ws[1]!.trim().slice(0, 60), projectId: ctx.projectId }] }
  }
  return null
}

export function parseCommand(raw: string, ctx: QueenContext): QueenParse {
  // A custom personality answers to her own name, like "queen".
  const name = ctx.queenName?.trim()
  const input = name ? raw.replace(new RegExp(`^\\s*(?:(?:hey|hi|ok|okay)\\s+)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[\\s,]*`, 'iu'), '') : raw
  // Small talk is answered, never sent to a model or mistaken for a command.
  const talk = parseSmallTalk(input)
  if (talk) return { kind: 'actions', actions: [{ type: 'chat', topic: talk }] }
  // Most specific first: notes, one-liners, then anything addressed to an agent by name.
  const direct = parseMemory(input) ?? parseQuick(input, ctx) ?? parseOpenAndSend(input, ctx) ?? parseMessage(input, ctx) ?? parseAddress(input, ctx)
  if (direct) return direct
  const text = fold(input)
  if (!text) return { kind: 'unknown' }

  const actions: QueenAction[] = []
  let verb: string | null = null
  // Hindi puts one verb at the very end of a list: "codex aur claude kholo" opens both.
  const parts = clauses(text)
  const tail = parts.at(-1)?.split(' ').at(-1) ?? ''
  const shared = parts.length > 1 && VERB_WORDS.test(tail) ? tail : null
  const ordered = shared ? parts.map((p, i) => (i < parts.length - 1 && !VERB_WORDS.test(p.split(' ')[0]!) ? `${shared} ${p}` : p)) : parts
  for (const clause of ordered) {
    const { result, verb: next } = parseClause(clause, ctx, verb)
    // One clause the rules can't place sends the whole command to the model: never half-run a request.
    if (result.kind !== 'actions') return result
    actions.push(...result.actions)
    verb = next
  }
  // "close Bruno and Luna" arrives as two clauses; it is one close and one question.
  const closing = [...new Set(actions.flatMap((a) => (a.type === 'close-agents' ? a.agentIds : [])))]
  if (!closing.length) return { kind: 'actions', actions }
  const names = closing.map((id) => ctx.agents.find((a) => a.id === id)?.petName ?? id)
  return {
    kind: 'actions',
    actions: [...actions.filter((a) => a.type !== 'close-agents'), { type: 'close-agents', agentIds: closing }],
    confirm: `Close ${names.length > 3 ? `${names.length} agents` : names.join(', ')}?`
  }
}
