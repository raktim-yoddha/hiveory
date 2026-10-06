import { describe, expect, it, vi } from 'vitest'
import { guard } from './guard'

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }

describe('guard', () => {
  it('returns the value of a step that works', () => {
    expect(guard(log, 'Ok', () => 42)).toBe(42)
  })

  it('contains a throwing step, logs and reports it', () => {
    const reported = vi.fn()
    expect(guard(log, 'Hotkey', () => { throw new Error('boom') }, reported)).toBeUndefined()
    expect(log.error).toHaveBeenCalledWith('Hotkey failed', expect.any(Error))
    expect(reported).toHaveBeenCalledOnce()
  })

  it('contains a rejecting async step', async () => {
    await expect(guard(log, 'Resume', () => Promise.reject(new Error('no')))).resolves.toBeUndefined()
  })

  it('survives a reporter that throws', () => {
    expect(() => guard(log, 'X', () => { throw new Error('a') }, () => { throw new Error('b') })).not.toThrow()
  })
})
