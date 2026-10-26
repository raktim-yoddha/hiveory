import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MAX_QUEUED } from '@shared/domain/prompt'
import type { CliRegistry } from '../cli/registry'
import type { WorkspaceRepository } from '../workspaces/workspace-repository'
import { ChatService } from './chat-service'
import { ChatStore } from './chat-store'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }

/** A chat service whose turns are recorded instead of spawned: `busy` stands for a turn still answering. */
const setup = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hv-queue-'))
  const store = new ChatStore(join(dir, 'chats'), log)
  store.load()
  const chats = new ChatService(store, {} as CliRegistry, {} as WorkspaceRepository, log, () => undefined, join(dir, 'attachments'))
  const internals = chats as unknown as { runs: Map<string, unknown>; sendQueued(chatId: string, failed: boolean): void; send(chatId: string, text: string): void }
  const sent: string[] = []
  internals.send = (_chatId, text) => void sent.push(text)
  const chat = chats.create()
  return {
    chats,
    store,
    sent,
    id: chat.id,
    busy: (on: boolean) => (on ? internals.runs.set(chat.id, { proc: { kill: () => undefined }, stopped: false }) : internals.runs.delete(chat.id)),
    turnEnds: (failed = false) => internals.sendQueued(chat.id, failed)
  }
}

describe('queued messages (ADR 0031)', () => {
  it('sends at once when idle, and lines messages up while answering', () => {
    const { chats, store, sent, id, busy, turnEnds } = setup()
    chats.enqueue(id, 'first')
    expect(sent).toEqual(['first'])
    busy(true)
    chats.enqueue(id, ' second ')
    chats.enqueue(id, 'third')
    expect(store.get(id)?.queued).toEqual(['second', 'third'])
    busy(false)
    turnEnds()
    expect(sent).toEqual(['first', 'second'])
    expect(store.get(id)?.queued).toEqual(['third'])
  })

  it('waits after a failed turn, keeps order when a turn already started, and lets one be taken out', () => {
    const { chats, store, sent, id, busy, turnEnds } = setup()
    busy(true)
    chats.enqueue(id, 'a')
    chats.enqueue(id, 'b')
    busy(false)
    turnEnds(true)
    expect(sent).toEqual([])
    busy(true)
    turnEnds()
    expect(sent).toEqual([])
    chats.unqueue(id, 0)
    expect(store.get(id)?.queued).toEqual(['b'])
  })

  it('caps the queue, and Stop drops what was waiting', () => {
    const { chats, store, id, busy } = setup()
    busy(true)
    for (let i = 0; i < MAX_QUEUED; i++) chats.enqueue(id, `m${i}`)
    expect(() => chats.enqueue(id, 'one more')).toThrow(`At most ${MAX_QUEUED}`)
    const internals = chats as unknown as { runs: Map<string, { proc: { kill(): void }; stopped: boolean }> }
    internals.runs.set(id, { proc: { kill: () => undefined }, stopped: false })
    chats.stop(id)
    expect(store.get(id)?.queued).toBeUndefined()
  })
})

describe('sending', () => {
  it('shows the question everywhere at once, before the reply starts', () => {
    const dir = mkdtempSync(join(tmpdir(), 'hv-send-'))
    const store = new ChatStore(join(dir, 'chats'), log)
    store.load()
    const events: { event: string; payload: unknown }[] = []
    const registry = { executable: () => process.execPath, displayName: () => 'Claude' } as unknown as CliRegistry
    const chats = new ChatService(store, registry, {} as WorkspaceRepository, log, (event, payload) => void events.push({ event, payload }), join(dir, 'attachments'))
    const chat = chats.create()
    store.save({ ...store.get(chat.id)!, cliId: 'claude', cwd: dir })
    chats.send(chat.id, 'hello')
    chats.stop(chat.id)
    const messages = events.filter((e) => e.event === 'chat.event').map((e) => (e.payload as { message: { role: string; parts: unknown[] } }).message)
    expect(messages[0]).toMatchObject({ role: 'user', parts: [{ kind: 'text', text: 'hello' }] })
    expect(messages[1]?.role).toBe('assistant')
  })
})

describe('where a chat works (ADR 0055)', () => {
  const repo = {
    project: (id: string) => ({ id, path: `/home/me/${id}` }),
    mirrors: (id: string) => (id === 'app' ? ['app', 'app-sub'] : [id]),
    get: (id: string) => ({ w1: { id: 'w1', projectId: 'app', path: '/home/me/app-trees/w1' }, w2: { id: 'w2', projectId: 'app-sub', path: '/home/me/app-trees/w2' }, w3: { id: 'w3', projectId: 'other', path: '/x' } })[id]
  } as unknown as WorkspaceRepository
  const make = () => {
    const dir = mkdtempSync(join(tmpdir(), 'hv-where-'))
    const store = new ChatStore(join(dir, 'chats'), log)
    store.load()
    return new ChatService(store, {} as CliRegistry, repo, log, () => undefined, join(dir, 'attachments'))
  }

  it("works in a Worktree of its Workspace (or a mirror's), and back in the Workspace's folder", () => {
    const chats = make()
    const { id } = chats.create()
    expect(chats.update(id, { projectId: 'app', workspaceId: 'w1' })).toMatchObject({ projectId: 'app', workspaceId: 'w1', cwd: '/home/me/app-trees/w1' })
    expect(chats.update(id, { workspaceId: 'w2' }).cwd).toBe('/home/me/app-trees/w2')
    expect(chats.update(id, { workspaceId: '' })).toMatchObject({ workspaceId: undefined, cwd: '/home/me/app' })
    // Another Workspace drops the Worktree.
    chats.update(id, { workspaceId: 'w1' })
    expect(chats.update(id, { projectId: 'other' })).toMatchObject({ projectId: 'other', workspaceId: undefined, cwd: '/home/me/other' })
  })

  it("refuses a Worktree of another Workspace, and moving once the chat has started", () => {
    const chats = make()
    const { id } = chats.create()
    expect(() => chats.update(id, { projectId: 'app', workspaceId: 'w3' })).toThrow(/not in this workspace/)
    expect(() => chats.update(id, { workspaceId: 'w1' })).toThrow(/not in this workspace/)
    chats.update(id, { projectId: 'app' })
    chats.get(id).messages.push({ id: 'm', role: 'user', parts: [], createdAt: '' })
    expect(() => chats.update(id, { workspaceId: 'w1' })).toThrow(/fixed once a chat has started/)
  })
})
