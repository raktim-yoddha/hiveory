import type { QueenAction, QueenContext, QueenParse, QueenSetting } from './actions'
import { cliAliases, norm } from './words'

/**
 * Commands for the rest of the app — settings, the browser, files, panes, Git and
 * GitHub, apps, updates, presets, chats, bots, sessions and projects — so Queen
 * Bee reaches what a click reaches. Like the rule parser, it never guesses: a
 * missing place or name becomes a question.
 */

const LEAD = /^\s*(?:(?:hey|hi|ok|okay)\s+)?(?:queen(?:\s+bee)?[\s,]+)?(?:please\s+)?(?:can you\s+|could you\s+)?/i
const actions = (...list: QueenAction[]): QueenParse => ({ kind: 'actions', actions: list })
const ask = (text: string, choices?: Array<{ label: string; command: string }>): QueenParse => ({ kind: 'ask', question: { text, choices } })
const needWorkspace = (what: string): QueenParse => ask(`Open a workspace first, then I can ${what}.`)

const SETTING_WORDS: Array<[RegExp, QueenSetting]> = [
  [/\b(agent tools?|coordination tools?|agent coordination)\b/, 'agent-tools'],
  [/\b(browser use|browser tools?|agents? browser|web browsing)\b/, 'browser-use'],
  [/\b(computer use|computer control|desktop control)\b/, 'computer-use'],
  [/\b(auto ?approve|auto approval|yolo|skip permissions?)\b/, 'auto-approve'],
  [/\b(chat ui|chat view|chat mode for agents)\b/, 'chat-ui']
]

/** Web addresses: an explicit scheme, localhost, www., or a host on a common top-level domain. */
const URL_LIKE =
  /^(?:https?:\/\/\S+|localhost(?::\d+)?(?:\/\S*)?|127\.0\.0\.1(?::\d+)?(?:\/\S*)?|www\.\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|net|io|dev|app|ai|co|in|us|uk|me|so|sh|xyz|info|edu|gov|tech|site|page|cloud)(?::\d+)?(?:\/\S*)?)$/i
const OPEN_URL = /^(?:open|go to|browse(?: to)?|visit|load|show(?: me)?|navigate to)\s+(?:the\s+)?(?:(?:web\s*)?(?:site|page|url|link)\s+)?(\S+)\s*$/i
const OPEN_FILE = /^(?:open|show(?: me)?|edit|view)\s+(?:the\s+)?(?:file\s+(?!(?:explorer|browser|manager|tree|panel|tab)\b)(\S+)|(\S+\.[a-z0-9]{1,8}))\s*(?:file)?\s*$/i

const SAVE_PRESET = /^(?:save|store|keep)\s+(?:this|these|the agents|this layout|this workspace|this setup|it)?\s*(?:as\s+)?(?:a\s+)?(?:new\s+)?preset(?:\s+(?:called|named|as))?\s+["“']?(.+?)["”']?\s*$/i
// "open chat" switches to Chat mode; a new chat says new or start.
const NEW_CHAT = /^(?:(?:start|begin)\s+(?:a\s+)?(?:new\s+)?|(?:open|create|make)\s+(?:a\s+)?new\s+|new\s+)chat(?:\s+(?:with|using|in)\s+([a-z0-9 .-]+?))?(?:\s*(?::|about|to|and (?:ask|say|tell)(?: it)?)\s+([\s\S]+))?\s*$/i
const TELL_BOT = /^(?:ask|tell|message|ping|have)\s+(?:the\s+)?(?:bot\s+)?([\s\S]+)$/i
const SWITCH = /^(pause|resume|unpause|stop|start|enable|disable|turn on|turn off|switch on|switch off|turn|switch)\s+(?:the\s+|my\s+)?(?:(routine|trigger)\s+)?(.+?)(?:\s+(routine|trigger))?(?:\s+(on|off))?$/i
const RESUME = /^(?:resume|continue|reopen|pick up)\b\s*(?:my\s+|the\s+)?(?:last\s+|latest\s+|previous\s+|recent\s+)?(.*?)\s*(?:session|conversation|chat)?\s*$/i

/** Parses one command for the app beyond agents; null when it is not one. */
export function parseAppCommand(raw: string, ctx: QueenContext): QueenParse | null {
  const input = raw.replace(LEAD, '').replace(/[.!?]+\s*$/, '').trim()
  const text = norm(input)
  if (!text) return null
  const ws = ctx.workspaceId

  // Settings toggles: "turn off browser use", "enable computer use", "auto approve on".
  const setting = SETTING_WORDS.find(([re]) => re.test(text))?.[1]
  if (setting && /\b(on|off|enable|enabled|disable|disabled|allow|block|activate|deactivate|start|stop)\b/.test(text)) {
    const on = !/\b(off|disable|disabled|block|deactivate|stop)\b/.test(text)
    return actions({ type: 'set-setting', setting, on })
  }

  // Git and GitHub of the current place.
  if (/^(git status|status of git|what (has )?changed|whats changed|what did (we|they|agents) change|show (me )?(the )?(changes|diff)|any (uncommitted )?changes|uncommitted changes|(which|what) branch( am i on| is this| are we on)?)$/.test(text)) {
    return ws ? actions({ type: 'git-status', workspaceId: ws }) : needWorkspace('check its changes')
  }
  if (/\b(pull requests?|prs?|merge requests?)\b/.test(text) && /^(show|list|any|open|what|which|how many|check|are there|my)\b|\bopen (pull requests?|prs?)\b/.test(text)) {
    return ctx.projectId ? actions({ type: 'pull-requests', projectId: ctx.projectId }) : ask('Open a project first, then I can list its pull requests.')
  }

  // Apps and updates.
  if (!/\bsettings?\b/.test(text) && /^(which|what|show|list|my|any)\b.*\b(apps|integrations|connected accounts)\b|\bconnected apps\b|\bapps (are )?connected\b/.test(text)) {
    return actions({ type: 'apps-report' })
  }
  if (/^(check (for )?updates?|any updates?|is there (an|a new) (update|version)|update available|am i up to date|is hiveory up to date|new version)$/.test(text)) {
    return actions({ type: 'check-updates' })
  }

  // Projects.
  if (/^(add|open|new|import) (a )?(new )?project( folder)?$/.test(text)) return actions({ type: 'add-project' })

  // Panes.
  if (/^(arrange|tidy|tidy up|organi[sz]e|even out|equali[sz]e|line up|reset|clean up)\b.*\b(panes?|agents?|windows?|layout|terminals?)\b/.test(text) || /^(arrange|tidy up)$/.test(text)) {
    if (!ws) return needWorkspace('arrange its panes')
    return actions({ type: 'arrange', layout: /\b(columns?|side by side)\b/.test(text) ? 'columns' : 'equal', workspaceId: ws })
  }

  // Presets: "save this as preset Backend".
  const preset = SAVE_PRESET.exec(input)
  if (preset) {
    if (!ws) return needWorkspace('save its agents as a preset')
    return actions({ type: 'save-preset', name: preset[1]!.trim().slice(0, 60), workspaceId: ws })
  }

  // Chats: "new chat", "start a chat with claude about the API".
  const chat = NEW_CHAT.exec(input)
  if (chat) {
    const wanted = chat[1] ? norm(chat[1]) : ''
    const cli = wanted ? ctx.clis.find((c) => c.kind !== 'shell' && cliAliases(c).includes(wanted)) : undefined
    if (wanted && !cli) return { kind: 'ask', soft: true, question: { text: `I don't know a CLI called "${chat[1]}".` } }
    const first = chat[2]?.replace(/^["“']|["”']$/g, '').trim()
    return actions({ type: 'new-chat', ...(cli ? { cliId: cli.id } : {}), ...(first ? { text: first } : {}), ...(ctx.projectId ? { projectId: ctx.projectId } : {}) })
  }

  // Bots: "ask Scout to summarize the inbox".
  const tell = TELL_BOT.exec(input)
  if (tell && ctx.bots?.length) {
    const after = tell[1]!.trim()
    const bot = [...ctx.bots].sort((a, b) => b.name.length - a.name.length).find((b) => norm(after).startsWith(`${norm(b.name)} `))
    // An agent with that name wins: agents are addressed by name everywhere else.
    if (bot && !ctx.agents.some((a) => norm(a.petName) === norm(bot.name))) {
      const message = after.split(/\s+/).slice(bot.name.trim().split(/\s+/).length).join(' ').replace(/^(?:bot\s+)?(?:to\s+)?/i, '').trim()
      if (message) return actions({ type: 'message-bot', botId: bot.id, text: message })
    }
  }

  // Routines and triggers: "pause Morning brief", "turn the New issue trigger back on".
  const flip = SWITCH.exec(input.replace(/\s+back(?=\s+on$)/i, ''))
  // "turn X" without on or off is not a switch.
  if (flip && ctx.automations?.length && (flip[5] || !/^(turn|switch)$/i.test(flip[1]!))) {
    const wanted = norm(flip[3]!)
    const kind = (flip[2] ?? flip[4])?.toLowerCase()
    const hits = ctx.automations.filter((x) => norm(x.name) === wanted && (!kind || x.kind === kind))
    // An agent with that name wins: "stop Bruno" interrupts the agent.
    if (hits.length && !ctx.agents.some((a) => norm(a.petName) === wanted)) {
      const on = flip[5] ? flip[5].toLowerCase() === 'on' : /^(resume|unpause|start|enable|turn on|switch on)$/i.test(flip[1]!)
      if (hits.length === 1) return actions({ type: 'switch-automation', automationId: hits[0]!.id, on })
      return ask(
        `More than one routine or trigger is called ${hits[0]!.name}. Which one?`,
        hits.map((x) => ({ label: `The ${x.kind}`, command: `${on ? 'resume' : 'pause'} ${x.name} ${x.kind}` }))
      )
    }
  }

  // Sessions: "resume my last claude session".
  const resume = RESUME.exec(input)
  if (resume) {
    const wanted = norm(resume[1] ?? '')
    const cli = ctx.clis.find((c) => c.kind !== 'shell' && cliAliases(c).includes(wanted))
    if (cli) return ws && ctx.projectId ? actions({ type: 'resume-session', cliId: cli.id, workspaceId: ws, projectId: ctx.projectId }) : needWorkspace('resume a session there')
    if (!wanted) {
      return ask(
        'Which CLI should I resume?',
        ctx.clis.filter((c) => c.kind !== 'shell').slice(0, 4).map((c) => ({ label: c.displayName, command: `resume ${c.displayName} session` }))
      )
    }
  }

  // The browser and files: "open github.com", "open README.md".
  const url = OPEN_URL.exec(input)
  if (url && URL_LIKE.test(url[1]!)) {
    if (!ws) return needWorkspace('open it in the browser')
    const target = url[1]!
    const full = /^https?:\/\//i.test(target) ? target : /^(localhost|127\.0\.0\.1)/i.test(target) ? `http://${target}` : `https://${target}`
    return actions({ type: 'open-url', url: full, workspaceId: ws })
  }
  const file = OPEN_FILE.exec(input)
  if (file) {
    if (!ws) return needWorkspace('open the file')
    return actions({ type: 'open-file', query: (file[1] ?? file[2])!, workspaceId: ws })
  }
  return null
}
