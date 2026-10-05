import type { ArrangeMode, CliInstance, Side } from '@shared/domain'
import type { AgentService } from '../agents/agent-service'
import type { BrowserTools } from '../browser/browser-tools'
import type { ChatService } from '../chat/chat-service'
import type { CliRegistry } from '../cli/registry'
import type { CliRuntimeManager } from '../cli/runtime/runtime-manager'
import type { LayoutService } from '../layout/layout-service'
import type { ShellService } from '../shell/shell-service'
import type { WorkspaceRepository } from '../workspaces/workspace-repository'
import type { ToolDefinition, ToolHost, ToolResult } from './mcp-protocol'
import { deliverMessage } from './deliver'
import { int, str, ToolError } from './tool-args'

export interface AgentToolDeps {
  agents: AgentService
  runtime: CliRuntimeManager
  layouts: LayoutService
  workspaces: WorkspaceRepository
  registry: CliRegistry
  shells: ShellService
  chats: ChatService
  /** The built-in browser's tools, when "Browser use" is on in Settings. */
  browser?: () => BrowserTools | null
  /** Further tool families (computer use), each listed only while enabled. */
  extraTools?: () => ToolFamily[]
}

/** A family of tools served beside the coordination tools (e.g. computer use). */
export interface ToolFamily {
  handles(name: string): boolean
  definitions(): ToolDefinition[]
  call(caller: { id: string; workspaceId: string; petName: string }, name: string, args: Record<string, unknown>): Promise<ToolResult>
}

const MAX_READ_LINES = 400
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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

  /** The last lines of a chat-view agent's conversation, as plain text. */
  private transcript(agentId: string, lines: number): string {
    const chat = this.deps.chats.get(agentId)
    const text = chat.messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Agent'}: ${m.parts.map((p) => (p.kind === 'tool' ? `[tool ${p.name}]` : p.text)).join('\n')}${m.error ? `\n(error: ${m.error})` : ''}`)
      .join('\n\n')
    return text.split('\n').slice(-lines).join('\n')
  }

  /** The latest assistant message of a chat-view agent. */
  private lastReply(agentId: string): string {
    const last = [...this.deps.chats.get(agentId).messages].reverse().find((m) => m.role === 'assistant')
    return last ? last.parts.map((p) => (p.kind === 'tool' ? `[tool ${p.name}]` : p.text)).join('\n') + (last.error ? `\n(error: ${last.error})` : '') : ''
  }

  private describe(agent: CliInstance): string {
    const runtime = this.deps.agents.details(agent)
    const cli = this.deps.registry.displayName(agent.cliId)
    const workspace = this.deps.workspaces.find(agent.workspaceId)?.name ?? 'unknown workspace'
    const status = !runtime.running ? 'not running' : runtime.status + (runtime.waitingReason ? ` (${runtime.waitingReason})` : '')
    return `${agent.petName} — ${cli} · workspace "${workspace}" · ${status}${agent.id === this.callerId ? ' · this is you' : ''}`
  }

  list(): ToolDefinition[] {
    return [
      ...this.coordinationTools(),
      ...(this.deps.browser?.()?.definitions() ?? []),
      ...(this.deps.extraTools?.() ?? []).flatMap((family) => family.definitions())
    ]
  }

  private coordinationTools(): ToolDefinition[] {
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
        name: 'ask_agent',
        description:
          'Fastest way to delegate: send a message to another agent, wait until it finishes, and return its reply — one call instead of send_message + wait_for_agent + read_agent.',
        inputSchema: {
          type: 'object',
          properties: {
            agent: agentArg,
            message: { type: 'string', minLength: 1, maxLength: 20000 },
            timeout_seconds: { type: 'integer', minimum: 1, maximum: 900, default: 300 },
            lines: { type: 'integer', minimum: 1, maximum: MAX_READ_LINES, default: 80, description: 'How much of its output to return.' }
          },
          required: ['agent', 'message'],
          additionalProperties: false
        }
      },
      {
        name: 'run_tools',
        description:
          'Run several Hiveory tool calls in ONE call — in parallel by default (e.g. message three agents, read two, open a page). Each item is {"tool": name, "args": {...}}; results come back in order.',
        inputSchema: {
          type: 'object',
          properties: {
            calls: {
              type: 'array',
              minItems: 1,
              maxItems: 25,
              items: { type: 'object', properties: { tool: { type: 'string' }, args: { type: 'object' } }, required: ['tool'] }
            },
            parallel: { type: 'boolean', default: true, description: 'false runs them one after another, stopping at the first error.' }
          },
          required: ['calls'],
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
    if (name === 'run_tools') return this.runTools(args)
    const extra = this.deps.extraTools?.()
    if (extra?.some((tool) => tool.handles(name))) {
      const caller = this.deps.agents.find(this.callerId)
      if (!caller) return { text: 'This agent is no longer registered in Hiveory.', isError: true }
      const host = extra.find((tool) => tool.handles(name))!
      return host.call({ id: caller.id, workspaceId: caller.workspaceId, petName: caller.petName }, name, args)
    }
    const browser = name.startsWith('browser_') ? this.deps.browser?.() : null
    if (browser) {
      const caller = this.deps.agents.find(this.callerId)
      if (!caller) return { text: 'This agent is no longer registered in Hiveory.', isError: true }
      return browser.call({ id: caller.id, workspaceId: caller.workspaceId, petName: caller.petName }, name, args)
    }
    try {
      return { text: await this.dispatch(name, args) }
    } catch (error) {
      if (error instanceof ToolError) return { text: error.message, isError: true }
      const message = error instanceof Error ? error.message : String(error)
      return { text: `Hiveory could not do that: ${message}`, isError: true }
    }
  }

  /** Many tool calls in one round trip: the model's turn, not the tools, is what costs seconds. */
  private async runTools(args: Record<string, unknown>): Promise<ToolResult> {
    const calls = Array.isArray(args.calls) ? (args.calls as Array<{ tool?: unknown; args?: unknown }>) : []
    if (!calls.length) return { text: 'calls must be a non-empty array of {"tool", "args"}.', isError: true }
    const known = new Set(this.list().map((t) => t.name))
    const one = async (c: { tool?: unknown; args?: unknown }): Promise<ToolResult> => {
      const tool = typeof c.tool === 'string' ? c.tool : ''
      if (tool === 'run_tools') return { text: 'run_tools cannot be nested.', isError: true }
      if (!known.has(tool)) return { text: `Unknown tool "${tool}".`, isError: true }
      return this.call(tool, typeof c.args === 'object' && c.args !== null ? (c.args as Record<string, unknown>) : {})
    }
    let results: ToolResult[]
    if (args.parallel === false) {
      results = []
      for (const c of calls) {
        const r = await one(c)
        results.push(r)
        if (r.isError) break
      }
    } else {
      results = await Promise.all(calls.map(one))
    }
    const text = results
      .map((r, i) => `### ${i + 1}. ${String(calls[i]?.tool)}${r.isError ? ' — failed' : ''}${r.image ? ' (image omitted; call the tool directly to see it)' : ''}\n${r.text}`)
      .join('\n\n')
    const skipped = calls.length - results.length
    return { text: skipped ? `${text}\n\n(${skipped} call(s) not run after the failure)` : text, isError: results.some((r) => r.isError) }
  }

  /** Waits until an agent has stopped working, giving a just-messaged agent a moment to start. */
  private async waitIdle(agent: CliInstance, timeoutMs: number, settleMs = 1500): Promise<boolean> {
    const deadline = Date.now() + timeoutMs
    const settleUntil = Date.now() + settleMs
    let sawWork = false
    for (;;) {
      const details = this.deps.agents.details(agent)
      const busy = details.running && (details.status === 'working' || (agent.chatUi === true && this.deps.chats.isRunning(agent.id)))
      if (busy) sawWork = true
      // Once it has been seen working, done means done; otherwise give it the settle window to start.
      if (!busy && (sawWork || Date.now() >= settleUntil)) return true
      if (Date.now() >= deadline) return false
      await sleep(150)
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
        const lines = int(args, 'lines', 80, 1, MAX_READ_LINES)
        if (agent.chatUi) return `${this.describe(agent)}\n--- conversation ---\n${this.transcript(agent.id, lines) || '(no messages yet)'}`
        const text = runtime.screenText(agent.id, lines)
        return `${this.describe(agent)}\n--- screen ---\n${text || '(nothing on screen yet)'}`
      }
      case 'send_message': {
        const agent = this.resolve(str(args, 'agent'))
        if (agent.id === this.callerId) throw new ToolError('You cannot send a message to yourself.')
        if (!agents.details(agent).running) throw new ToolError(`${agent.petName} is not running. Ask the user to start it first.`)
        if (this.deps.chats.isRunning(agent.id) && agent.chatUi) throw new ToolError(`${agent.petName} is still replying. Use wait_for_agent first.`)
        return deliverMessage(this.deps, agent, str(args, 'message'), args.submit !== false)
      }
      case 'wait_for_agent': {
        const agent = this.resolve(str(args, 'agent'))
        if (agent.id === this.callerId) throw new ToolError('You cannot wait for yourself.')
        const done = await this.waitIdle(agent, int(args, 'timeout_seconds', 300, 1, 900) * 1000)
        return `${done ? 'Done waiting.' : 'Timed out; still working.'} ${this.describe(agent)}`
      }
      case 'ask_agent': {
        const agent = this.resolve(str(args, 'agent'))
        if (agent.id === this.callerId) throw new ToolError('You cannot ask yourself.')
        const sent = await this.dispatch('send_message', { agent: agent.petName, message: str(args, 'message'), submit: true })
        const done = await this.waitIdle(agent, int(args, 'timeout_seconds', 300, 1, 900) * 1000, 2500)
        const lines = int(args, 'lines', 80, 1, MAX_READ_LINES)
        const reply = agent.chatUi ? this.lastReply(agent.id) : runtime.screenText(agent.id, lines)
        return `${sent} ${done ? 'It finished.' : 'Timed out while it was still working.'}\n--- ${agent.chatUi ? 'reply' : 'screen'} ---\n${reply || '(nothing yet)'}`
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
        // Output that stops changing for half a second means the command is done (or waiting).
        while (Date.now() < deadline) {
          await sleep(100)
          const now = shells.screenText(id, MAX_READ_LINES)
          if (now !== last) {
            last = now
            stableSince = Date.now()
          } else if (now !== before && Date.now() - stableSince > 500) break
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
