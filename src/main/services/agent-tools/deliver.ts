import type { CliInstance } from '@shared/domain'
import type { AgentService } from '../agents/agent-service'
import type { ChatService } from '../chat/chat-service'
import type { CliRuntimeManager } from '../cli/runtime/runtime-manager'
import { ToolError } from './tool-args'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Types a message into an agent and (by default) submits it: the one path shared by
 * agents (send_message) and Queen Bee. Chat-view agents get a chat turn; terminal
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
