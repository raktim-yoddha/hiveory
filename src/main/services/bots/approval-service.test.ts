import { describe, expect, it, vi } from 'vitest'
import type { ToolFamily } from '../agent-tools/agent-tools'
import { ApprovalService } from './approval-service'

const caller = { id: 't1', workspaceId: 'bot-b1', petName: 'Scout' }

const setup = (timeoutMs?: number) => {
  const notify = vi.fn()
  const service = new ApprovalService({ changed: vi.fn(), notify, ...(timeoutMs ? { timeoutMs } : {}) })
  const calls: string[] = []
  const family: ToolFamily = {
    handles: () => true,
    definitions: () => [],
    call: async (_c, name) => {
      calls.push(name)
      return { text: 'ok' }
    }
  }
  return { service, family, calls, notify }
}

describe('approvals', () => {
  it('lets reads and allowed changes through without asking', async () => {
    const { service, family, calls, notify } = setup()
    const tools = service.guard(family, { botId: 'b1', threadId: 't1', level: 'sends', readOnly: false })
    expect((await tools.call(caller, 'composio_GMAIL_FETCH_EMAILS', {})).text).toBe('ok')
    expect((await tools.call(caller, 'composio_GMAIL_CREATE_EMAIL_DRAFT', {})).text).toBe('ok')
    expect(calls).toHaveLength(2)
    expect(notify).not.toHaveBeenCalled()
  })

  it('waits for a yes before sending, and runs nothing on a no', async () => {
    const { service, family, calls, notify } = setup()
    const tools = service.guard(family, { botId: 'b1', threadId: 't1', level: 'sends', readOnly: false })
    const allowed = tools.call(caller, 'composio_GMAIL_SEND_EMAIL', { to: 'alex@example.com' })
    await Promise.resolve()
    const [request] = service.list()
    expect(request).toMatchObject({ botId: 'b1', threadId: 't1', tool: 'composio_GMAIL_SEND_EMAIL', risk: 'send' })
    expect(request!.detail).toContain('alex@example.com')
    expect(notify).toHaveBeenCalledOnce()
    expect(calls).toEqual([])
    service.answer(request!.id, true)
    expect((await allowed).text).toBe('ok')

    const declined = tools.call(caller, 'composio_SLACK_SEND_MESSAGE', {})
    await Promise.resolve()
    service.answer(service.list()[0]!.id, false)
    expect(await declined).toMatchObject({ isError: true })
    expect(calls).toEqual(['composio_GMAIL_SEND_EMAIL'])
    expect(() => service.answer('gone', true)).toThrow()
  })

  it('refuses changes in a read-only run without asking', async () => {
    const { service, family, calls } = setup()
    const tools = service.guard(family, { botId: 'b1', threadId: 't1', level: 'never', readOnly: true })
    expect(await tools.call(caller, 'composio_GITHUB_ADD_LABELS_TO_AN_ISSUE', {})).toMatchObject({ isError: true })
    expect((await tools.call(caller, 'composio_GITHUB_GET_AN_ISSUE', {})).text).toBe('ok')
    expect(calls).toEqual(['composio_GITHUB_GET_AN_ISSUE'])
    expect(service.list()).toEqual([])
  })

  it('declines on timeout and when the thread or bot goes away', async () => {
    vi.useFakeTimers()
    try {
      const { service, family } = setup(1000)
      const tools = service.guard(family, { botId: 'b1', threadId: 't1', level: 'changes', readOnly: false })
      const timedOut = tools.call(caller, 'files_write_file', {})
      await vi.advanceTimersByTimeAsync(1001)
      expect(await timedOut).toMatchObject({ isError: true })

      const dropped = tools.call(caller, 'files_write_file', {})
      await Promise.resolve()
      service.drop({ botId: 'b1' })
      expect(await dropped).toMatchObject({ isError: true })
      expect(service.list()).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})
