import type { CliInstance } from '@shared/domain'
import type { AgentService } from '../agents/agent-service'
import type { ChatService } from '../chat/chat-service'
import type { CliRuntimeManager } from '../cli/runtime/runtime-manager'
import { ToolError } from './tool-args'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** More rows than any screen has: `screenText` counts from the bottom, so this reads the whole screen. */
const SCREEN_ROWS = 200

/**
 * Types a message into an agent and (by default) submits it: the one path shared by
 * agents (send_message) and the phone. Chat-view agents get a chat turn; terminal
 * agents get bracketed paste when their TUI supports it, so multi-line text stays one prompt.
 */
export async function deliverMessage(
  deps: { agents: AgentService; runtime: CliRuntimeManager; chats: ChatService },
  agent: CliInstance,
  message: string,
  submit = true
): Promise<string> {
  if (!deps.agents.details(agent).running) throw new ToolError(`${agent.petName} is not running. Start it first.`)
  if (agent.chatUi) {
    if (deps.chats.isRunning(agent.id)) throw new ToolError(`${agent.petName} is still replying. Wait for it to finish.`)
    deps.chats.send(agent.id, message)
    return `Sent to ${agent.petName} and submitted.`
  }
  const { runtime } = deps
  runtime.write(agent.id, runtime.bracketedPaste(agent.id) ? `\x1b[200~${message}\x1b[201~` : message.replace(/\r?\n/g, ' '))
  if (submit) {
    await sleep(80)
    runtime.write(agent.id, '\r')
  }
  return `Sent to ${agent.petName}${submit ? ' and submitted' : ' (not submitted)'}.`
}

/** Waits until an agent has stopped working, giving a just-messaged agent a moment to start. */
export async function waitIdle(deps: { agents: AgentService; chats: ChatService }, agent: CliInstance, timeoutMs: number, settleMs = 1500): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  const settleUntil = Date.now() + settleMs
  let sawWork = false
  for (;;) {
    const details = deps.agents.details(agent)
    const busy = details.running && (details.status === 'working' || (agent.chatUi === true && deps.chats.isRunning(agent.id)))
    if (busy) sawWork = true
    // Once it has been seen working, done means done; otherwise give it the settle window to start.
    if (!busy && (sawWork || Date.now() >= settleUntil)) return true
    if (Date.now() >= deadline) return false
    await sleep(150)
  }
}

/**
 * Waits until a just-opened agent can take a message: running, idle for 2 s and something on its
 * screen (chat-view agents are ready once running). A question first (trust this folder?) stops the
 * wait: typing into it would answer it.
 */
export async function waitReady(
  deps: { agents: AgentService; runtime: CliRuntimeManager },
  agent: CliInstance,
  timeoutMs = 60_000
): Promise<'ready' | 'waiting' | 'stopped' | 'timeout'> {
  const started = Date.now()
  let idleSince: number | null = null
  let screen = ''
  for (;;) {
    const details = deps.agents.details(agent)
    const now = Date.now()
    if (details.status === 'waiting-for-you') return 'waiting'
    if (!details.running && now - started > 5000) return 'stopped'
    if (details.running && agent.chatUi) return 'ready'
    if (details.running && details.status === 'idle') {
      // Quiet means nothing new on screen: a CLI still drawing its start-up reads no input yet,
      // and text typed into it then is lost (a Schedule's prompt, a message).
      // The whole screen, not its last rows: a fresh terminal prints at the top, and its bottom rows
      // stay blank, so a CLI that just started would never look ready.
      const shown = deps.runtime.screenText(agent.id, SCREEN_ROWS)
      if (shown !== screen) {
        screen = shown
        idleSince = now
      }
      idleSince ??= now
      if (now - idleSince >= 2000 && now - started >= 3000 && screen.trim()) return 'ready'
    } else idleSince = null
    if (now - started > timeoutMs) return 'timeout'
    await sleep(250)
  }
}
