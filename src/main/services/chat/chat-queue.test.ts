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
    busy: (on: boolean) => (on ? internals.runs.set(chat.id, {}) : internals.runs.delete(chat.id)),
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
    const internals = chats as unknown as { runs: Map<string, { child: unknown; stopped: boolean }> }
    internals.runs.set(id, { child: { pid: undefined, kill: () => true }, stopped: false })
    chats.stop(id)
    expect(store.get(id)?.queued).toBeUndefined()
  })
})
