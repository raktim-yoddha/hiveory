import { MAX_NOTE_LENGTH, MAX_OPEN_PER_COMMAND, type QueenAction, type QueenContext, type QueenParse, type QueenSettingsSection } from './actions'

/**
 * Tier 0 of Queen Bee: a rule parser for the commands people actually say. It
 * needs no model, answers in well under a millisecond, and never guesses: an
 * unknown or ambiguous name becomes a question, anything else becomes
 * "unknown" for the model tier.
 */

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, couple: 2, pair: 2, few: 3, single: 1, another: 1,
  // Hinglish, as speech recognition writes it.
  ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, saat: 7, aath: 8, aat: 8
}

/**
 * Hinglish (romanised Hindi, as typed or as Whisper writes it) folded into the
 * same canonical words. Hindi puts the verb last ("do codex kholo"); parseClause
 * moves a trailing verb to the front.
 */
const HINGLISH: Array<[RegExp, string]> = [
  [/\b(kya chal raha hai|kya ho raha hai|status batao|kya bacha hai|kitna bacha hai|update do)\b/g, 'status'],
  [/\b(kaun wait kar raha hai|kaun ruka hai|kisko meri zarurat hai|kaun atka hai)\b/g, 'who is waiting'],
  [/\b(restart karo|restart kar do|dobara chalao|phir se chalao)\b/g, 'restart'],
  [/\b(khol do|khol de|kholo|kolo|khol|chalu karo|chalu kar do|chalao|start karo|shuru karo)\b/g, 'open'],
  [/\b(band karo|band kar do|band kardo|bandh karo|bund karo|hata do|hatao|band)\b/g, 'close'],
  [/\b(dikhao|dikha do|dikhau|dekhao|par jao|pe jao|jao)\b/g, 'show'],
  [/\baur\b/g, 'and'],
  [/\b(ko|zara|jaldi|bhai|yaar|na)\b/g, ' ']
]

/** Multi-word phrasings folded into one canonical verb before parsing. */
const PHRASES: Array<[RegExp, string]> = [
  ...HINGLISH,
  [/\b(take me to|bring me to|navigate to|head to|jump to|switch to|move to|go back to|go to)\b/g, 'go'],
  [/\b(spin up|fire up|boot up|bring up|start up|kick off)\b/g, 'open'],
  [/\b(shut down|close down|get rid of)\b/g, 'close'],
  [/\b(show me|let me see)\b/g, 'show'],
  [/\bside ?bar on the right\b|\bright (side ?bar|side ?panel|panel)\b/g, 'side panel'],
  [/\bfile (tree|explorer)\b/g, 'explorer'],
  [/\b(\d+)\s*x\b|\bx\s*(\d+)\b/g, '$1$2']
]

/** Words that carry no meaning for a command. */
const FILLER = /^(hey |hi |ok |okay )?(queen bee|queen|ada|sunny|frankie)\b|\b(please|pls|plz|can you|could you|would you|will you|kindly|hey|hi|ok|okay|for me|right now|now|quickly|just|the|new|some|my|i want|i need|id like|lets)\b/g

const CLOSE_VERBS = /^(close|kill|stop|remove|end|quit|terminate|dismiss)\b/
const RESTART_VERBS = /^(restart|reboot|rerun|reload)\b/
const OPEN_VERBS = /^(open|start|launch|spawn|add|create|run|give|get)\b/
const GO_VERBS = /^(go|show|open|focus|find|view|display|visit)\b/

const norm = (text: string): string =>
  text
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

/** Splits "open two claude and a codex, then go to chat" into clauses. */
const clauses = (text: string): string[] =>
  text
    .split(/\s*(?:[,;]|\band then\b|\bthen\b|\band\b|\balso\b|\bplus\b)\s*/)
    .map((c) => c.trim())
    .filter(Boolean)

const hasWord = (text: string, word: string): boolean => new RegExp(`(^| )${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`).test(text)

/** Every way a user may name a CLI: "Claude Code" → claude code, claude, claudecode. */
const cliAliases = (cli: QueenContext['clis'][number]): string[] => {
  const name = norm(cli.displayName)
  const short = name.replace(/ (code )?cli$| code$/, '')
  return [...new Set([norm(cli.id), name, short, short.replace(/ /g, '')])].filter(Boolean)
}

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
        question: {
          text: match ? `Which workspace do you mean?` : `There's no workspace called "${name}".`,
          choices: options.slice(0, 4).map((w) => ({ label: w.name, command: `${clause.slice(0, m.index).trim()} in ${w.name}` }))
        }
      }
    }
  }
  return ctx.workspaceId ? { id: ctx.workspaceId } : null
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

const VERB_WORDS = /^(open|close|show|go|restart)$/

const parseClause = (sentence: string, ctx: QueenContext, previousVerb: string | null): { result: QueenParse; verb: string | null } => {
  // Verb-last word order (Hindi, "settings show"): bring the verb to the front.
  const words = sentence.split(' ')
  const clause = words.length > 1 && VERB_WORDS.test(words.at(-1)!) && !VERB_WORDS.test(words[0]!) ? [words.at(-1)!, ...words.slice(0, -1)].join(' ') : sentence
  const done = (actions: QueenAction[], verb: string | null = null): { result: QueenParse; verb: string | null } => ({ result: { kind: 'actions', actions }, verb })
  const ask = (text: string, choices?: Array<{ label: string; command: string }>) => ({ result: { kind: 'ask', question: { text, choices } } as QueenParse, verb: null })

  // Reports: anything asking how things stand.
  if (/\b(status|report|summary|summarize|progress|overview|update me|catch me up|whats (left|done|happening|going on|up|pending)|what is (left|done|happening|pending)|who(s| is) (waiting|working|idle|stuck|free|busy)|anyone (waiting|stuck)|any agents? (waiting|stuck|working|idle)|how are (agents|things|we doing)|what are agents doing|stuck)\b/.test(clause)) {
    const focus = /\b(waiting|stuck|blocked|need me|needs me)\b/.test(clause)
      ? 'waiting-for-you'
      : /\b(working|busy)\b/.test(clause)
        ? 'working'
        : /\b(idle|free)\b/.test(clause)
          ? 'idle'
          : 'all'
    return done([{ type: 'report', focus }])
  }

  // Mode.
  if (/^(go |open |show )?(chat|chats|chat mode|chatspace)$/.test(clause)) return done([{ type: 'set-mode', mode: 'chatspace' }])
  if (/^(go |open |show )?(work|work mode|workspace mode|terminals)$/.test(clause)) return done([{ type: 'set-mode', mode: 'workspace' }])
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
      return ask(match ? 'Which preset?' : name ? `There's no preset called "${name}".` : 'Which preset?', (match && 'many' in match ? match.many : ctx.presets).slice(0, 4).map((p) => ({ label: p.name, command: `load preset ${p.name}` })))
    }
    const ws = targetWorkspace(clause, ctx)
    if (!ws) return ask('Open a workspace first, then load the preset.')
    if ('ask' in ws) return { result: ws.ask, verb: null }
    return done([{ type: 'apply-preset', presetId: match.one.id, workspaceId: ws.id, projectId: ctx.projectId! }])
  }

  const verb = CLOSE_VERBS.test(clause) ? 'close' : RESTART_VERBS.test(clause) ? 'restart' : OPEN_VERBS.test(clause) ? 'open' : GO_VERBS.test(clause) ? 'go' : previousVerb
  const agents = findAgents(clause, ctx)

  if (verb === 'close') {
    const everyone = /\b(all|every|everyone|everything)\b/.test(clause)
    const ofCli = findClis(clause, ctx)
    const targets = agents.length
      ? agents
      : everyone
        ? ctx.agents.filter((a) => a.workspaceId === ctx.workspaceId && (!ofCli.length || ofCli.some((c) => c.cliId === a.cliId)))
        : []
    if (!targets.length) {
      const here = ctx.agents.filter((a) => a.workspaceId === ctx.workspaceId)
      return ask(here.length ? 'Which agent should I close?' : 'There are no agents open here.', here.slice(0, 4).map((a) => ({ label: a.petName, command: `close ${a.petName}` })))
    }
    return done([{ type: 'close-agents', agentIds: targets.map((a) => a.id) }], 'close')
  }

  if (verb === 'restart') {
    if (agents.length !== 1) return ask('Which agent should I restart?', ctx.agents.filter((a) => a.workspaceId === ctx.workspaceId).slice(0, 4).map((a) => ({ label: a.petName, command: `restart ${a.petName}` })))
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
    // A workspace or project by name.
    const target = clause.replace(/^(go|show|open|focus|find|view|display|visit)\b/, '').replace(/\b(workspace|project)\b/g, '').trim()
    if (target) {
      const ws = target === 'main' ? ctx.workspaces.find((w) => w.kind === 'main') : (() => { const m = matchName(target, ctx.workspaces); return m && 'one' in m ? m.one : undefined })()
      if (ws && ctx.projectId && !/\bproject\b/.test(clause)) return done([{ type: 'navigate', to: 'workspace', projectId: ctx.projectId, workspaceId: ws.id }], verb)
      const project = matchName(target, ctx.projects)
      if (project && 'one' in project) return done([{ type: 'navigate', to: 'project', projectId: project.one.id }], verb)
      if (project && 'many' in project) return ask('Which project?', project.many.slice(0, 4).map((p) => ({ label: p.name, command: `go ${p.name} project` })))
    }
    if (verb === 'open' && /\b(agents?|cli|terminal)\b/.test(clause)) {
      return ask('Which agent should I open?', ctx.clis.slice(0, 4).map((c) => ({ label: c.displayName, command: `open ${c.displayName}` })))
    }
  }

  return { result: { kind: 'unknown' }, verb: null }
}

/** "tell Bruno to run the tests": the message keeps the user's exact words and casing. */
const MESSAGE = /^\s*(?:(?:hey|ok|okay)\s+)?(?:queen(?:\s+bee)?[\s,]+)?(?:please\s+)?(?:tell|ask|message|instruct|have|get)\s+([\p{L}\p{N}_-]+)[\s,:]+(?:to\s+)?([\s\S]+?)\s*$/iu

function parseMessage(input: string, ctx: QueenContext): QueenParse | null {
  const m = MESSAGE.exec(input)
  if (!m) return null
  const named = ctx.agents.filter((a) => a.petName.toLowerCase() === m[1]!.toLowerCase())
  if (!named.length) return null
  if (named.length > 1) return { kind: 'ask', question: { text: `There's more than one ${named[0]!.petName}.` } }
  const text = m[2]!.replace(/^["“']|["”']$/g, '').trim()
  if (!text) return null
  return { kind: 'actions', actions: [{ type: 'message-agent', agentId: named[0]!.id, text }] }
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

export function parseCommand(raw: string, ctx: QueenContext): QueenParse {
  // A custom personality answers to her own name, like "queen".
  const name = ctx.queenName?.trim()
  const input = name ? raw.replace(new RegExp(`^\\s*(?:(?:hey|hi|ok|okay)\\s+)?${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[\\s,]*`, 'iu'), '') : raw
  const memory = parseMemory(input)
  if (memory) return memory
  const message = parseMessage(input, ctx)
  if (message) return message
  let text = norm(input)
  for (const [re, to] of PHRASES) text = text.replace(re, to)
  text = text.replace(FILLER, ' ').replace(/\s+/g, ' ').trim()
  if (!text) return { kind: 'unknown' }

  const actions: QueenAction[] = []
  let verb: string | null = null
  for (const clause of clauses(text)) {
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
