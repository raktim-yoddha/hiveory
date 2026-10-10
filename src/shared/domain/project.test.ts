import { describe, expect, it } from 'vitest'
import { opensAsChat, workspaceColor, WORKSPACE_COLORS } from './project'

describe('how new agents open (ADR 0037, 0038)', () => {
  it('follows the Workspace, then the Worktree, then the app', () => {
    expect(opensAsChat({ settings: { agentView: 'terminal' } }, { chatUi: true }, true)).toBe(false)
    expect(opensAsChat({}, { chatUi: false }, true)).toBe(false)
    expect(opensAsChat({}, {}, true)).toBe(true)
    expect(opensAsChat(undefined, undefined)).toBe(false)
  })
})

describe('Workspace colors (ADR 0038)', () => {
  it('keeps a chosen color and otherwise picks a stable one from the id', () => {
    expect(workspaceColor({ id: 'p1', settings: { color: 'red' } })).toBe('red')
    expect(workspaceColor({ id: 'p1' })).toBe(workspaceColor({ id: 'p1' }))
    expect(WORKSPACE_COLORS).toContain(workspaceColor({ id: 'another' }))
  })
})
