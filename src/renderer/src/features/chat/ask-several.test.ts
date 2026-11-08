import { beforeEach, describe, expect, it, vi } from 'vitest'

const opened: Array<{ cliId: string; beside: string; chatUi?: boolean }> = []
const sent: Array<{ id: string; text: string }> = []

vi.mock('../agents/agent-actions', () => ({
  agentActions: {
    open: vi.fn(async (_ws: string, cliId: string, placement: { targetPaneId: string }, _resume: unknown, chatUi?: boolean) => {
      opened.push({ cliId, beside: placement.targetPaneId, chatUi })
      return cliId === 'broken' ? undefined : { id: `chat-${cliId}` }
    })
  }
}))
vi.mock('../../stores/chat', () => ({
  useChat: { getState: () => ({ send: async (id: string, text: string) => (sent.push({ id, text }), true) }) }
}))

const { askSeveral } = await import('./ask-several')

describe('askSeveral', () => {
  beforeEach(() => {
    opened.length = 0
    sent.length = 0
  })

  it('opens one chat per CLI, each to the right of the last, and sends them the text', async () => {
    const ids = await askSeveral('ws1', 'chat-codex', ['claude', 'gemini'], 'hello')
    expect(ids).toEqual(['chat-claude', 'chat-gemini'])
    expect(opened).toEqual([
      { cliId: 'claude', beside: 'chat-codex', chatUi: true },
      { cliId: 'gemini', beside: 'chat-claude', chatUi: true }
    ])
    expect(sent).toEqual([
      { id: 'chat-claude', text: 'hello' },
      { id: 'chat-gemini', text: 'hello' }
    ])
  })

  it('skips a CLI whose chat could not open and keeps going', async () => {
    const ids = await askSeveral('ws1', 'chat-codex', ['broken', 'gemini'], 'hi')
    expect(ids).toEqual(['chat-gemini'])
    expect(opened.at(-1)).toMatchObject({ cliId: 'gemini', beside: 'chat-codex' })
    expect(sent).toEqual([{ id: 'chat-gemini', text: 'hi' }])
  })
})
