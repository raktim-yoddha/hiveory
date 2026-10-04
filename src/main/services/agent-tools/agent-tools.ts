import type { ArrangeMode, CliInstance, Side } from '@shared/domain'
import type { AgentService } from '../agents/agent-service'
import type { CliRegistry } from '../cli/registry'
import type { CliRuntimeManager } from '../cli/runtime/runtime-manager'
import type { LayoutService } from '../layout/layout-service'
import type { ShellService } from '../shell/shell-service'
import type { WorkspaceRepository } from '../workspaces/workspace-repository'
import type { ToolDefinition, ToolHost, ToolResult } from './mcp-protocol'

export interface AgentToolDeps {
  agents: AgentService
  runtime: CliRuntimeManager
  layouts: LayoutService
  workspaces: WorkspaceRepository
  registry: CliRegistry
  shells: ShellService
}

const MAX_READ_LINES = 400
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

class ToolError extends Error {}

const str = (args: Record<string, unknown>, key: string, required = true): string => {
  const value = args[key]
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (required) throw new ToolError(`Missing required argument "${key}".`)
  return ''
}

const int = (args: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number => {
  const value = args[key]
  if (value === undefined || value === null) return fallback
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) throw new ToolError(`"${key}" must be a number.`)
  return Math.min(max, Math.max(min, Math.round(n)))
}

/**
 * Hiveory's agent tools, served over MCP to every agent it launches. One
 * instance per calling agent: everything is scoped to that agent's project,
 * names come from list_agents, and errors always say what *is* valid so an
 * agent can correct itself in one step.
 */
export class AgentTools implements ToolHost {
  constructor(
    private readonly deps: AgentToolDeps,
    private readonly callerId: string
  ) {}

  private get caller(): CliInstance {
    const caller = this.deps.agents.find(this.callerId)
    if (!caller) throw new ToolError('This agent is no longer registered in Hiveory.')
    return caller
  }

  private projectAgents(): CliInstance[] {
    return this.deps.agents.instancesInProject(this.caller.projectId)
  }

  private resolve(name: string): CliInstance {
    const agents = this.projectAgents()
    const wanted = name.trim().toLowerCase()
    const match = agents.find((a) => a.petName.toLowerCase() === wanted || a.id === name.trim())
    if (!match) {
      throw new ToolError(`No agent named "${name}". Agents in this project: ${agents.map((a) => a.petName).join(', ') || 'none'}.`)
    }
    return match
  }

  private describe(agent: CliInstance): string {
    const runtime = this.deps.runtime.details(agent.id)
    const cli = this.deps.registry.displayName(agent.cliId)
    const workspace = this.deps.workspaces.find(agent.workspaceId)?.name ?? 'unknown workspace'
    const status = !runtime.running ? 'not running' : runtime.status + (runtime.waitingReason ? ` (${runtime.waitingReason})` : '')
    return `${agent.petName} — ${cli} · workspace "${workspace}" · ${status}${agent.id === this.callerId ? ' · this is you' : ''}`
  }

  list(): ToolDefinition[] {
    const clis = this.deps.registry.list().filter((c) => c.available).map((c) => c.id)
    const agentArg = { type: 'string', description: 'Exact agent name from list_agents, e.g. "Milo".' }
    return [
      {
        name: 'list_agents',
        description: 'List every agent in this project with its CLI, workspace and live status. Call this first.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
      },
      {
        name: 'read_agent',
        description: "Read the text currently on another agent's terminal screen (its latest output).",
        inputSchema: {
          type: 'object',
          properties: { agent: agentArg, lines: { type: 'integer', minimum: 1, maximum: MAX_READ_LINES, default: 80 } },
          required: ['agent'],
          additionalProperties: false
        }
      },
      {
        name: 'send_message',
        description: 'Type a message into another agent and (by default) press Enter to submit it.',
        inputSchema: {
          type: 'object',
          properties: {
            agent: agentArg,
            message: { type: 'string', minLength: 1, maxLength: 20000 },
            submit: { type: 'boolean', default: true, description: 'Press Enter after typing.' }
          },
          required: ['agent', 'message'],
          additionalProperties: false
        }
      },
      {
        name: 'wait_for_agent',
        description: 'Wait until an agent stops working (becomes idle or waiting-for-you), then report its status.',
        inputSchema: {
          type: 'object',
          properties: { agent: agentArg, timeout_seconds: { type: 'integer', minimum: 1, maximum: 900, default: 300 } },
          required: ['agent'],
          additionalProperties: false
        }
      },
      {
        name: 'open_agent',
        description: 'Open a new agent in a new pane. It joins your workspace unless placed beside an agent in another one.',
        inputSchema: {
          type: 'object',
          properties: {
            cli: { type: 'string', enum: clis, description: 'Which installed CLI to start.' },
            beside: { ...agentArg, description: 'Optional: place the new pane next to this agent.' },
            side: { type: 'string', enum: ['right', 'bottom'], default: 'right' }
          },
          required: ['cli'],
          additionalProperties: false
        }
      },
      {
        name: 'close_agent',
        description: 'Close another agent and its pane. You cannot close yourself.',
        inputSchema: { type: 'object', properties: { agent: agentArg }, required: ['agent'], additionalProperties: false }
      },
      {
        name: 'arrange_panes',
        description: 'Rearrange every pane in your workspace: equal grid, focus (one agent takes half), or columns.',
        inputSchema: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['equal', 'focus', 'columns'] },
            focus: { ...agentArg, description: 'For mode "focus": the agent that gets half the space (default: you).' }
          },
          required: ['mode'],
          additionalProperties: false
        }
      },
      {
        name: 'run_in_terminal',
        description: "Run a shell command in your workspace's terminal (the side panel) and return its recent output.",
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', minLength: 1, maxLength: 8000 },
            wait_seconds: { type: 'integer', minimum: 0, maximum: 120, default: 8, description: 'Max time to wait for output to settle.' }
          },
          required: ['command'],
          additionalProperties: false
        }
      },
      {
        name: 'read_terminal',
        description: "Read your workspace terminal's latest output.",
        inputSchema: {
          type: 'object',
          properties: { lines: { type: 'integer', minimum: 1, maximum: MAX_READ_LINES, default: 60 } },
          additionalProperties: false
        }
      }
    ]
  }

  async call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      return { text: await this.dispatch(name, args) }
    } catch (error) {
      if (error instanceof ToolError) return { text: error.message, isError: true }
      const message = error instanceof Error ? error.message : String(error)
      return { text: `Hiveory could not do that: ${message}`, isError: true }
    }
  }

  private async dispatch(name: string, args: Record<string, unknown>): Promise<string> {
    const { agents, runtime, layouts, workspaces, registry, shells } = this.deps
    switch (name) {
      case 'list_agents': {
        const project = workspaces.project(this.caller.projectId)
        const lines = this.projectAgents().map((a) => `- ${this.describe(a)}`)
        return `Project "${project.name}" has ${lines.length} agent(s):\n${lines.join('\n')}`
      }
      case 'read_agent': {
        const agent = this.resolve(str(args, 'agent'))
        const text = runtime.screenText(agent.id, int(args, 'lines', 80, 1, MAX_READ_LINES))
        return `${this.describe(agent)}\n--- screen ---\n${text || '(nothing on screen yet)'}`
      }
      case 'send_message': {
        const agent = this.resolve(str(args, 'agent'))
        if (agent.id === this.callerId) throw new ToolError('You cannot send a message to yourself.')
        if (!runtime.details(agent.id).running) throw new ToolError(`${agent.petName} is not running. Ask the user to start it first.`)
        const message = str(args, 'message')
        const submit = args.submit !== false
        // Bracketed paste keeps multi-line text as one prompt in TUIs that support it.
        runtime.write(agent.id, runtime.bracketedPaste(agent.id) ? `\x1b[200~${message}\x1b[201~` : message.replace(/\r?\n/g, ' '))
        if (submit) {
          await sleep(80)
          runtime.write(agent.id, '\r')
        }
        return `Sent to ${agent.petName}${submit ? ' and submitted' : ' (not submitted)'}.`
      }
      case 'wait_for_agent': {
        const agent = this.resolve(str(args, 'agent'))
        if (agent.id === this.callerId) throw new ToolError('You cannot wait for yourself.')
        const deadline = Date.now() + int(args, 'timeout_seconds', 300, 1, 900) * 1000
        // Give a just-messaged agent a moment to start working before judging it idle.
        const settleUntil = Date.now() + 2500
        for (;;) {
          const details = runtime.details(agent.id)
          const busy = details.running && details.status === 'working'
          if (!busy && Date.now() >= settleUntil) return `Done waiting. ${this.describe(agent)}`
          if (Date.now() >= deadline) return `Timed out; still working. ${this.describe(agent)}`
          await sleep(400)
        }
      }
      case 'open_agent': {
        const cliId = str(args, 'cli')
        const cli = registry.list().find((c) => c.id === cliId || c.displayName.toLowerCase() === cliId.toLowerCase())
        if (!cli?.available) {
          const available = registry.list().filter((c) => c.available).map((c) => c.id)
          throw new ToolError(`"${cliId}" is not an installed CLI. Installed: ${available.join(', ')}.`)
        }
        const beside = str(args, 'beside', false)
        const target = beside ? this.resolve(beside) : this.caller
        const side: Side = args.side === 'bottom' ? 'bottom' : 'right'
        const { agent } = agents.open(target.workspaceId, cli.id, { targetPaneId: target.id, side })
        return `Opened ${agent.petName} (${cli.displayName}) ${side === 'right' ? 'to the right of' : 'below'} ${target.petName}.`
      }
      case 'close_agent': {
        const agent = this.resolve(str(args, 'agent'))
        if (agent.id === this.callerId) throw new ToolError('You cannot close yourself.')
        agents.close(agent.id)
        return `Closed ${agent.petName}.`
      }
      case 'arrange_panes': {
        const mode = str(args, 'mode') as ArrangeMode
        if (!['equal', 'focus', 'columns'].includes(mode)) throw new ToolError('mode must be one of: equal, focus, columns.')
        const focusName = str(args, 'focus', false)
        const focus = focusName ? this.resolve(focusName) : this.caller
        const workspaceId = this.caller.workspaceId
        if (focus.workspaceId !== workspaceId) throw new ToolError(`${focus.petName} is in another workspace.`)
        layouts.apply(workspaceId, agents.paneIds(workspaceId), { type: 'arrange', mode, focusPaneId: focus.id })
        return `Arranged panes: ${mode}${mode === 'focus' ? ` on ${focus.petName}` : ''}.`
      }
      case 'run_in_terminal': {
        const workspace = workspaces.get(this.caller.workspaceId)
        const { id } = shells.open(workspace.id, workspace.path)
        const before = shells.screenText(id, MAX_READ_LINES)
        shells.write(id, `${str(args, 'command')}\r`)
        const waitMs = int(args, 'wait_seconds', 8, 0, 120) * 1000
        const deadline = Date.now() + waitMs
        let last = before
        let stableSince = Date.now()
        while (Date.now() < deadline) {
          await sleep(250)
          const now = shells.screenText(id, MAX_READ_LINES)
          if (now !== last) {
            last = now
            stableSince = Date.now()
          } else if (now !== before && Date.now() - stableSince > 900) break
        }
        return `$ ${str(args, 'command')}\n${shells.screenText(id, 60)}`
      }
      case 'read_terminal': {
        const workspace = workspaces.get(this.caller.workspaceId)
        const id = `shell-${workspace.id}`
        if (!shells.has(id)) return 'The workspace terminal has not been opened yet. Use run_in_terminal to start it.'
        return shells.screenText(id, int(args, 'lines', 60, 1, MAX_READ_LINES)) || '(terminal is empty)'
      }
      default:
        throw new ToolError(`Unknown tool: ${name}`)
    }
  }
}
