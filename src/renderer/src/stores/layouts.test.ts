import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LayoutNode } from '@shared/domain'

const api = vi.fn()
vi.mock('../lib/api', () => ({ api: (...args: unknown[]) => api(...args) }))
vi.mock('./notices', () => ({ reportError: vi.fn() }))

const { useLayouts } = await import('./data')

const before: LayoutNode = {
  type: 'split',
  direction: 'horizontal',
  ratios: [0.5, 0.5],
  children: [
    { type: 'pane', paneId: 'a' },
    { type: 'pane', paneId: 'b' }
  ]
}
const resize = { type: 'resize' as const, path: [], ratios: [0.3, 0.7] }

describe('layout store', () => {
  beforeEach(() => {
    api.mockReset()
    useLayouts.setState({ byWorkspace: { w: before } })
  })

  it('shows a released divider at once, before main answers', async () => {
    let answer: (tree: LayoutNode) => void = () => undefined
    api.mockReturnValueOnce(new Promise<LayoutNode>((resolve) => (answer = resolve)))
    const applying = useLayouts.getState().apply('w', resize)
    const shown = useLayouts.getState().byWorkspace.w
    expect(shown?.type === 'split' && shown.ratios).toEqual([0.3, 0.7])
    answer(shown!)
    await applying
    expect(useLayouts.getState().byWorkspace.w).toEqual(shown)
  })

  it('falls back to main’s layout when the change fails', async () => {
    api.mockRejectedValueOnce(new Error('nope')).mockResolvedValueOnce(before)
    await useLayouts.getState().apply('w', resize)
    expect(useLayouts.getState().byWorkspace.w).toEqual(before)
    expect(api).toHaveBeenLastCalledWith('layout.get', { workspaceId: 'w' })
  })
})
