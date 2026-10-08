import { describe, expect, it, vi } from 'vitest'

// The hook's store reads localStorage at import; the snap math needs none of it.
vi.mock('./useQueen', () => ({ useQueen: { getState: () => ({}) } }))
const { spotAt } = await import('./useMarkGestures')

describe('floating Queen Bee snap', () => {
  it('snaps to the third of the window the drag ends in', () => {
    expect(spotAt(10, 1200)).toBe('left')
    expect(spotAt(399, 1200)).toBe('left')
    expect(spotAt(600, 1200)).toBe('middle')
    expect(spotAt(801, 1200)).toBe('right')
    expect(spotAt(1199, 1200)).toBe('right')
  })
})
