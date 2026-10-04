import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CliInstance, CliRuntimeDetails, Workspace } from '@shared/domain'
import type { ChatService } from '../chat/chat-service'
import type { CliRegistry } from '../cli/registry'
import type { CliRuntimeManager } from '../cli/runtime/runtime-manager'
import { LayoutService } from '../layout/layout-service'
import { StateStore } from '../persistence/state-store'
import { WorkspaceRepository } from '../workspaces/workspace-repository'
import { AgentService } from './agent-service'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }

const setup = (workspacePatch: Partial<Workspace> = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'hiveory-agents-'))
  const folder = join(dir, 'repo')
  mkdirSync(folder)
  const store = new StateStore(join(dir, 'state.json'), log)
  const workspace: Workspace = {
    id: 'w1', projectId: 'p1', name: 'Amber', kind: 'isolated', path: folder, autoApprove: false,
    createdAt: '', updatedAt: '', ...workspacePatch
  }
  store.update((s) => {
    s.projects.push({ id: 'p1', name: 'demo', path: folder, createdAt: '', updatedAt: '', lastOpenedAt: '' })
    s.workspaces.push(workspace)
  })
  const details = new Map<string, CliRuntimeDetails>()
  const runtime = Object.assign(new EventEmitter(), {
    details: (id: string) => details.get(id) ?? { status: 'idle', running: false },
    launch: vi.fn((instance: CliInstance) => details.set(instance.id, { status: 'idle', running: true })),
    stop: vi.fn(),
    dispose: vi.fn()
  })
  const chats = Object.assign(new EventEmitter(), {
    running: new Set<string>(),
    isRunning(id: string) {
      return this.running.has(id)
    },
    ensureAgentChat: vi.fn(),
    stop: vi.fn(),
    delete: vi.fn()
  })
  const registry = { adapter: () => ({ supportsAutoApprove: true }) }
  const emitted: Array<[string, unknown]> = []
  const agents = new AgentService(
    store,
    new WorkspaceRepository(store),
    new LayoutService(store, () => undefined),
    registry as unknown as CliRegistry,
    runtime as unknown as CliRuntimeManager,
    log,
    (channel, payload) => void emitted.push([channel, payload]),
    chats as unknown as ChatService
  )
  /** Simulates the runtime reporting a status change for an instance. */
  const report = (instance: CliInstance, next: CliRuntimeDetails): void => {
    details.set(instance.id, next)
    runtime.emit('changed', instance, next)
  }
  return { agents, runtime, chats, report, emitted }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('agents in chat view', () => {
  it('opens chat-capable CLIs as chats and keeps a terminal for the rest', () => {
    const { agents, runtime, chats } = setup({ chatUi: true })
    const claude = agents.open('w1', 'claude').agent
    const antigravity = agents.open('w1', 'antigravity').agent
    expect(claude.chatUi).toBe(true)
    expect(antigravity.chatUi).toBe(false)
    expect(chats.ensureAgentChat).toHaveBeenCalledWith(expect.objectContaining({ id: claude.id }), expect.any(String))
    expect(runtime.launch).toHaveBeenCalledTimes(1)
    expect(runtime.launch).toHaveBeenCalledWith(expect.objectContaining({ id: antigravity.id }), expect.any(String), { soleOfCli: true })
  })

  it('is always ready, working while a reply streams, and reports it to the Kanban', () => {
    const { agents, chats, emitted } = setup({ chatUi: true })
    const { agent } = agents.open('w1', 'codex')
    expect(agents.list('w1')[0]!.runtime).toEqual({ status: 'idle', running: true })
    chats.running.add(agent.id)
    chats.emit('run', agent.id, true)
    expect(agents.list('w1')[0]!.runtime).toMatchObject({ status: 'working', running: true })
    expect(emitted.at(-1)).toEqual(['runtime.changed', expect.objectContaining({ instanceId: agent.id, runtime: expect.objectContaining({ status: 'working' }) })])
    expect(agents.find(agent.id)!.hasConversation).toBe(true)
  })

  it('deletes the chat when the agent closes', () => {
    const { agents, chats, runtime } = setup({ chatUi: true })
    const { agent } = agents.open('w1', 'claude')
    agents.close(agent.id)
    expect(chats.delete).toHaveBeenCalledWith(agent.id)
    expect(runtime.dispose).not.toHaveBeenCalled()
  })
})

describe('crash recovery', () => {
  it('restarts an agent that crashes after running a while', () => {
    vi.useFakeTimers()
    const { agents, runtime, report } = setup()
    const { agent } = agents.open('w1', 'opencode')
    report(agent, { status: 'idle', running: true })
    vi.advanceTimersByTime(60_000)
    report(agent, { status: 'idle', running: false, error: 'Process exited with code 3' })
    vi.advanceTimersByTime(1_500)
    expect(runtime.launch).toHaveBeenCalledTimes(2)
  })

  it('leaves clean exits and start-up failures alone', () => {
    vi.useFakeTimers()
    const { agents, runtime, report } = setup()
    const { agent } = agents.open('w1', 'opencode')
    report(agent, { status: 'idle', running: true })
    vi.advanceTimersByTime(60_000)
    report(agent, { status: 'idle', running: false, activity: 'Session ended' })
    report(agent, { status: 'idle', running: true })
    vi.advanceTimersByTime(2_000)
    report(agent, { status: 'idle', running: false, error: 'Process exited with code 1' })
    vi.advanceTimersByTime(5_000)
    expect(runtime.launch).toHaveBeenCalledTimes(1)
  })

  it('stops retrying a CLI that keeps crashing', () => {
    vi.useFakeTimers()
    const { agents, runtime, report } = setup()
    const { agent } = agents.open('w1', 'opencode')
    for (let i = 0; i < 5; i++) {
      report(agent, { status: 'idle', running: true })
      vi.advanceTimersByTime(15_000)
      report(agent, { status: 'idle', running: false, error: 'Process exited with code 3' })
      vi.advanceTimersByTime(1_500)
    }
    expect(runtime.launch).toHaveBeenCalledTimes(1 + 3)
  })
})

describe('durable sessions', () => {
  it('brings every terminal agent back on start-up, without a Start button', () => {
    vi.useFakeTimers()
    const { agents, runtime, report } = setup()
    const a = agents.open('w1', 'claude').agent
    const b = agents.open('w1', 'codex').agent
    // Simulate an app restart: nothing is running any more.
    report(a, { status: 'idle', running: false })
    report(b, { status: 'idle', running: false })
    runtime.launch.mockClear()
    agents.resumeAll()
    vi.advanceTimersByTime(1_000)
    expect(runtime.launch.mock.calls.map(([i]) => (i as CliInstance).id).sort()).toEqual([a.id, b.id].sort())
  })

  it('starts a fresh session when a resumed one cannot be found', () => {
    vi.useFakeTimers()
    const { agents, runtime, report, chats } = setup()
    const { agent } = agents.open('w1', 'opencode')
    report(agent, { status: 'working', running: true }) // the conversation started
    report(agent, { status: 'idle', running: false })
    agents.restart(agent.id) // resumes
    report(agents.find(agent.id)!, { status: 'idle', running: true })
    report(agents.find(agent.id)!, { status: 'idle', running: false, error: 'Process exited with code 1' })
    vi.advanceTimersByTime(1_500)
    expect(agents.find(agent.id)!.hasConversation).toBe(false)
    expect(runtime.launch).toHaveBeenCalledTimes(3)
    expect(chats.ensureAgentChat).not.toHaveBeenCalled()
  })
})

