import { describe, expect, it } from 'vitest'
import { fitWindow } from './window-state'

const screen = { x: 0, y: 0, width: 1920, height: 1040 }
const second = { x: 1920, y: 0, width: 1280, height: 1000 }

describe('window position and size (ADR 0061)', () => {
  it('reopens where it was, maximized or not', () => {
    expect(fitWindow({ x: 100, y: 80, width: 1200, height: 800, maximized: true }, [screen])).toEqual({ x: 100, y: 80, width: 1200, height: 800, maximized: true })
    expect(fitWindow({ x: 2000, y: 10, width: 1000, height: 700 }, [screen, second])).toEqual({ x: 2000, y: 10, width: 1000, height: 700, maximized: false })
  })

  it('opens at its default when the screen it was on is gone or it is mostly off-screen', () => {
    expect(fitWindow({ x: 2000, y: 10, width: 1000, height: 700 }, [screen])).toBeUndefined()
    expect(fitWindow({ x: 1500, y: 0, width: 1000, height: 700 }, [screen])).toBeUndefined()
  })

  it('never goes below the minimum or above the screen, and ignores damaged files', () => {
    expect(fitWindow({ x: 0, y: 0, width: 300, height: 200 }, [screen])).toMatchObject({ width: 960, height: 600 })
    expect(fitWindow({ x: 0, y: 0, width: 5000, height: 4000 }, [screen])).toMatchObject({ width: 1920, height: 1040 })
    for (const bad of [undefined, null, 'x', { x: 'a', y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: Infinity, height: 1 }]) expect(fitWindow(bad, [screen])).toBeUndefined()
    expect(fitWindow({ x: 0, y: 0, width: 1000, height: 700 }, [])).toBeUndefined()
  })
})
