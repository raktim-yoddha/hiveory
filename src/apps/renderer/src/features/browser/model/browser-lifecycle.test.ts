import { afterEach, describe, expect, it, vi } from 'vitest'
import { cancelScheduledBrowserClose, scheduleBrowserClose } from './browser-lifecycle'

describe('browser lifecycle', () => {
  afterEach(() => {
    cancelScheduledBrowserClose('browser-a')
    vi.useRealTimers()
  })

  it('cancels a stale close when the same browser remounts', () => {
    vi.useFakeTimers()
    const close = vi.fn()

    scheduleBrowserClose('browser-a', close)
    cancelScheduledBrowserClose('browser-a')
    vi.runAllTimers()

    expect(close).not.toHaveBeenCalled()
  })

  it('runs a close when the browser remains unmounted', () => {
    vi.useFakeTimers()
    const close = vi.fn()

    scheduleBrowserClose('browser-a', close)
    vi.runAllTimers()

    expect(close).toHaveBeenCalledOnce()
  })
})
