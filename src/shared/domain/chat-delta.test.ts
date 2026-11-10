import { describe, expect, it } from 'vitest'
import type { ChatMessage, ChatSummary } from './chat'
import { applyChatAppends, chatAppends, chatSent } from './chat-delta'

const summary: ChatSummary = { id: 'c1', title: 'Chat', updatedAt: 't', running: true }
const reply = (parts: ChatMessage['parts'], extra: Partial<ChatMessage> = {}): ChatMessage => ({ id: 'm1', role: 'assistant', parts, createdAt: 't', streaming: true, ...extra })
const text = (t: string) => ({ kind: 'text' as const, text: t })

describe('chat deltas (ADR 0068)', () => {
  it('sends only the text added to each part', () => {
    const before = chatSent(reply([{ kind: 'thinking', text: 'hm' }, text('Hello')]), summary)
    const now = chatSent(reply([{ kind: 'thinking', text: 'hmm' }, text('Hello, world')]), summary)
    expect(chatAppends(before, now)).toEqual([
      { part: 0, at: 2, text: 'm' },
      { part: 1, at: 5, text: ', world' }
    ])
  })

  it('has nothing to send when nothing changed', () => {
    const sent = chatSent(reply([text('same')]), summary)
    expect(chatAppends(sent, chatSent(reply([text('same')]), summary))).toEqual([])
  })

  it('sends the whole message the first time, and whenever more than text was added', () => {
    const before = chatSent(reply([text('a')]), summary)
    const whole = (now: ChatMessage, s = summary) => expect(chatAppends(before, chatSent(now, s))).toBeNull()
    expect(chatAppends(null, before)).toBeNull()
    whole(reply([text('a'), text('b')])) // a new part
    whole(reply([text('a'), { kind: 'tool', id: 't', name: 'Read', status: 'running' }]))
    whole(reply([text('rewritten')])) // not an addition
    whole(reply([text('ab')], { streaming: false })) // the end
    whole(reply([text('ab')], { tasks: [{ text: 'x', status: 'pending' }] }))
    whole(reply([text('ab')], { error: 'Stopped' }))
    whole(reply([text('ab')]), { ...summary, title: 'Renamed' })
    whole(reply([text('ab')]), { ...summary, queued: ['next'] })
  })

  it('a tool whose output changed sends the whole message', () => {
    const tool = (output: string) => ({ kind: 'tool' as const, id: 't', name: 'Bash', output, status: 'running' as const })
    expect(chatAppends(chatSent(reply([text('a'), tool('1')]), summary), chatSent(reply([text('ab'), tool('12')]), summary))).toBeNull()
  })

  it('applying the appends gives the message they were taken from, for any way of cutting the stream', () => {
    const full = 'The quick brown fox jumps over the lazy dog. '.repeat(40)
    for (const step of [1, 7, 64, 500]) {
      let held = reply([text('')])
      let sent = chatSent(held, summary)
      for (let end = step; end < full.length + step; end += step) {
        const now = reply([text(full.slice(0, end))])
        const next = chatSent(now, summary)
        held = applyChatAppends(held, chatAppends(sent, next)!)!
        sent = next
      }
      expect(held.parts).toEqual([text(full)])
    }
  })

  it('an append that arrives after a reload that already holds part or all of it adds nothing twice', () => {
    const held = reply([text('Hello, wor')])
    expect(applyChatAppends(held, [{ part: 0, at: 5, text: ', world' }])!.parts).toEqual([text('Hello, world')])
    expect(applyChatAppends(held, [{ part: 0, at: 0, text: 'Hello' }])!.parts).toEqual([text('Hello, wor')])
  })

  it('an append that does not fit is refused, so the viewer reloads', () => {
    const held = reply([text('Hello'), { kind: 'tool', id: 't', name: 'Read', status: 'done' }])
    expect(applyChatAppends(held, [{ part: 0, at: 9, text: 'x' }])).toBeNull() // a gap
    expect(applyChatAppends(held, [{ part: 1, at: 0, text: 'x' }])).toBeNull() // not text
    expect(applyChatAppends(held, [{ part: 2, at: 0, text: 'x' }])).toBeNull() // no such part
  })

  it('leaves the message it was given untouched', () => {
    const held = reply([text('a')])
    applyChatAppends(held, [{ part: 0, at: 1, text: 'b' }])
    expect(held.parts).toEqual([text('a')])
  })
})
