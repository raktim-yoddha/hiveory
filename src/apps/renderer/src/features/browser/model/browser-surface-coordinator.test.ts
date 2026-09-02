import { describe, expect, it, vi } from 'vitest'
import {
  acquireBrowserSurfaceBlocker,
  areBrowserSurfacesSuspended,
  subscribeBrowserSurfaceSuspension,
} from './browser-surface-coordinator'

describe('browser surface coordinator', () => {
  it('keeps surfaces suspended until every nested blocker is released', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeBrowserSurfaceSuspension(listener)
    const releaseMenu = acquireBrowserSurfaceBlocker('menu')
    const releaseDialog = acquireBrowserSurfaceBlocker('dialog')

    expect(areBrowserSurfacesSuspended()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenLastCalledWith(true)

    releaseMenu()
    expect(areBrowserSurfacesSuspended()).toBe(true)
    expect(listener).toHaveBeenCalledTimes(1)

    releaseDialog()
    expect(areBrowserSurfacesSuspended()).toBe(false)
    expect(listener).toHaveBeenLastCalledWith(false)
    unsubscribe()
  })

  it('makes blocker releases idempotent', () => {
    const release = acquireBrowserSurfaceBlocker('temporary')
    release()
    release()
    expect(areBrowserSurfacesSuspended()).toBe(false)
  })
})
