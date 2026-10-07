import type { RoutineTarget } from '@shared/domain/routine'
import type { AgentService } from '../agents/agent-service'
import { deliverMessage, waitIdle, waitReady } from '../agent-tools/deliver'
import type { ChatService } from '../chat/chat-service'
import type { CliRuntimeManager } from '../cli/runtime/runtime-manager'

type WorkTarget = Extract<RoutineTarget, { kind: 'workspace' }>

/** A Work run never waits longer than this for its agent to finish; the routine's own limit usually ends it first. */
const MAX_WORK_RUN_MS = 24 * 60 * 60 * 1000

const NOT_READY = {
  waiting: 'asked a question before it could start. Answer it in Work, then run the routine again.',
  stopped: 'stopped before it could start.',
  timeout: 'was not ready after a minute.'
} as const

/**
 * A routine's run in a Work workspace (ADR 0030): opens a new agent of the CLI there, types the
 * instructions once it is ready, and resolves when it stops working. The agent stays open, and its
 * card moves on the Kanban by its real state like any other (rules 6–7); nothing is recorded in Work.
 */
export function startWorkRun(
  deps: { agents: AgentService; runtime: CliRuntimeManager; chats: ChatService },
  target: WorkTarget,
  prompt: string
): { agentId: string; done: Promise<{ ok: boolean; detail?: string }> } {
  const opened = deps.agents.open(target.workspaceId, target.cliId).agent
  const agent = deps.agents.find(opened.id) ?? opened
  const done = (async () => {
    const ready = await waitReady(deps, agent)
    if (ready !== 'ready') return { ok: false, detail: `${agent.petName} ${NOT_READY[ready]}` }
    await deliverMessage(deps, agent, prompt)
    await waitIdle(deps, agent, MAX_WORK_RUN_MS, 2500)
    const after = deps.agents.details(agent)
    if (!after.running) return { ok: false, detail: `${agent.petName} stopped.` }
    return after.status === 'waiting-for-you' ? { ok: true, detail: `${agent.petName} is waiting for you in Work.` } : { ok: true }
  })()
  return { agentId: agent.id, done }
}
