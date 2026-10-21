import { randomBytes } from 'node:crypto'
import type { HostTransport, KeptHook } from '@shared/host/protocol'
import type { Logger } from '../main/app/logger'
import { MCP_TOOL_TIMEOUT_MS } from '../main/services/cli/adapters/mcp-injection'
import { HookServer } from '../main/services/cli/hooks/hook-server'

/** Hooks kept per agent while no app is attached; the newest win. */
export const KEPT_HOOKS_PER_AGENT = 64

const notOpen = (body: unknown, message: string) => ({
  jsonrpc: '2.0',
  id: typeof body === 'object' && body !== null && 'id' in body ? (body as { id: unknown }).id : null,
  error: { code: -32001, message }
})

/**
 * The daemon's relay (ADR 0050 §6): the loopback URL agents report hooks to and reach their tools
 * through, owned by the daemon so it outlives the app. Its port and token are kept in `keepFile`.
 * With an app attached, hooks become `relay.hook` events and MCP requests `relay.mcp` events the app
 * answers with `relay.reply`. Without one, hooks are kept (`relay.kept` hands them over) and MCP
 * requests are told Hiveory is not open; the agent keeps working without its tools.
 */
export const createRelay = (out: () => HostTransport | null, keepFile: string, log: Logger) => {
  const kept = new Map<string, KeptHook[]>()
  const pending = new Map<string, { resolve: (body: unknown) => void; timer: NodeJS.Timeout }>()

  const server = new HookServer(
    (instanceId, event, payload) => {
      const client = out()
      if (client) return client.send({ kind: 'event', event: 'relay.hook', params: { instanceId, event, payload } })
      const list = kept.get(instanceId) ?? []
      list.push({ instanceId, event, payload, at: Date.now() })
      if (list.length > KEPT_HOOKS_PER_AGENT) list.splice(0, list.length - KEPT_HOOKS_PER_AGENT)
      kept.set(instanceId, list)
    },
    log,
    keepFile
  )

  server.setMcpHandler(
    (instanceId, body) =>
      new Promise((resolve) => {
        const client = out()
        if (!client) return resolve(notOpen(body, 'Hiveory is not open, so its tools are unavailable. Keep working; they return when it opens.'))
        const requestId = randomBytes(8).toString('hex')
        // Longer than any tool call may take, so the agent's own timeout always fires first.
        const timer = setTimeout(() => {
          pending.delete(requestId)
          resolve(notOpen(body, 'Hiveory did not answer.'))
        }, MCP_TOOL_TIMEOUT_MS + 30_000)
        pending.set(requestId, { resolve, timer })
        client.send({ kind: 'event', event: 'relay.mcp', params: { requestId, instanceId, body } })
      })
  )

  return {
    server,
    calls: {
      'relay.kept': (): KeptHook[] => {
        const all = [...kept.values()].flat().sort((a, b) => a.at - b.at)
        kept.clear()
        return all
      }
    },
    notifications: {
      'relay.reply': (params: unknown) => {
        const { requestId, body } = params as { requestId: string; body: unknown }
        const call = pending.get(requestId)
        if (!call) return
        pending.delete(requestId)
        clearTimeout(call.timer)
        call.resolve(body ?? null)
      }
    },
    /** The app went away mid-request: its pending tool calls end now rather than at the timeout. */
    detached: (): void => {
      for (const [id, call] of pending) {
        clearTimeout(call.timer)
        call.resolve(notOpen(null, 'Hiveory closed before answering.'))
        pending.delete(id)
      }
    }
  }
}
