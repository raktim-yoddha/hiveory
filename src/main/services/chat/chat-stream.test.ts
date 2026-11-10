import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CliInstance } from '@shared/domain'
import type { ChatMessage, ChatSession } from '@shared/domain/chat'
import { applyChatAppends, type ChatAppend } from '@shared/domain/chat-delta'
import type { CliRegistry } from '../cli/registry'
import type { Audience } from '../events'
import type { WorkspaceRepository } from '../workspaces/workspace-repository'
import type { ChatProcess } from './chat-process'
import { ChatService } from './chat-service'
import { ChatStore } from './chat-store'
import { plainParser, type LineParser } from './parsers'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }

/** A chat whose reply the test prints line by line, with every event it sends and to whom. */
const streaming = () => {
  const dir = mkdtempSync(join(tmpdir(), 'hv-stream-'))
  const store = new ChatStore(join(dir, 'chats'), log)
  store.load()
  const events: Array<{ event: string; payload: unknown; audience?: Audience }> = []
  const chats = new ChatService(store, {} as CliRegistry, {} as WorkspaceRepository, log, (event, payload, audience) => void events.push({ event, payload: structuredClone(payload), audience }), join(dir, 'attachments'))
  chats.ensureAgentChat({ id: 'a1', petName: 'Ada', projectId: 'p1', cliId: 'copilot', autoApprove: false } as CliInstance, dir)
  const chat = store.get('a1')!
  const reply: ChatMessage = { id: 'r1', role: 'assistant', parts: [], createdAt: 't', streaming: true }
  chat.messages.push(reply)
  let print: (data: string) => void = () => undefined
  let close: (code: number | null) => void = () => undefined
  const proc: ChatProcess = { onStdout: (l) => void (print = l), onStderr: () => undefined, onClose: (l) => void (close = l), kill: () => undefined, detach: () => undefined }
  ;(chats as unknown as { follow(chat: ChatSession, reply: ChatMessage, proc: ChatProcess, parse: LineParser): void }).follow(chat, reply, proc, plainParser())
  return { events, reply, print: (data: string) => print(data), close: () => close(0) }
}

/** The reply as a viewer holds it after these events, in order. */
const held = (events: Array<{ event: string; payload: unknown }>): ChatMessage | undefined => {
  let message: ChatMessage | undefined
  for (const { event, payload } of events) {
    const p = payload as { message?: ChatMessage; messageId?: string; appends?: ChatAppend[] }
    if (event === 'chat.event' && p.message?.id === 'r1') message = p.message
    if (event === 'chat.delta' && p.messageId === 'r1') message = applyChatAppends(message!, p.appends!) ?? undefined
  }
  return message
}

describe('a streaming reply (ADR 0068)', () => {
  afterEach(() => vi.useRealTimers())

  it('reaches the window as added text and paired clients whole, and both end with the same reply', () => {
    vi.useFakeTimers()
    const { events, reply, print, close } = streaming()
    const lines = 200
    for (let n = 1; n <= lines; n++) {
      print(`line ${n} of the answer, with some words in it\n`)
      vi.advanceTimersByTime(60)
    }
    const whileStreaming = [...events]
    close()
    vi.advanceTimersByTime(100)

    const text = Array.from({ length: lines }, (_, i) => `line ${i + 1} of the answer, with some words in it\n`).join('')
    const forWindow = (list: typeof events) => list.filter((e) => e.audience !== 'clients')
    const forClients = (list: typeof events) => list.filter((e) => e.audience !== 'window')

    // While it streams, each viewer holds everything printed so far.
    expect(held(forWindow(whileStreaming))?.parts).toEqual([{ kind: 'text', text }])
    expect(held(forClients(whileStreaming))?.parts).toEqual([{ kind: 'text', text }])
    // Paired clients never see a delta: they are told the whole reply, as before.
    expect(forClients(events).some((e) => e.event === 'chat.delta')).toBe(false)
    // At the end both hold the finished reply.
    expect(held(forWindow(events))).toEqual(held(forClients(events)))
    expect(held(forWindow(events))).toMatchObject({ streaming: false, parts: reply.parts })

    // The window was sent each character about once, not once per update.
    const sentToWindow = forWindow(events).reduce((n, e) => {
      const p = e.payload as { message?: ChatMessage; appends?: ChatAppend[] }
      const whole = (p.message?.parts ?? []).reduce((sum, part) => sum + ('text' in part ? part.text.length : 0), 0)
      return n + whole + (p.appends ?? []).reduce((sum, a) => sum + a.text.length, 0)
    }, 0)
    expect(sentToWindow / text.length).toBeLessThan(3)
  })
})
