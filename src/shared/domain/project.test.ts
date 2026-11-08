import { describe, expect, it } from 'vitest'
import { workspaceColor, WORKSPACE_COLORS } from './project'

describe('Workspace colors (ADR 0038)', () => {
  it('keeps a chosen color and otherwise picks a stable one from the id', () => {
    expect(workspaceColor({ id: 'p1', settings: { color: 'red' } })).toBe('red')
    expect(workspaceColor({ id: 'p1' })).toBe(workspaceColor({ id: 'p1' }))
    expect(WORKSPACE_COLORS).toContain(workspaceColor({ id: 'another' }))
  })
})
