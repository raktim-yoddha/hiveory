import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/api', () => ({ api: vi.fn() }))
vi.mock('./notices', () => ({ reportError: vi.fn() }))

const { useNavigation, selectedProjectId } = await import('./navigation')

// ADR 0062: Schedules and Workspace settings left the side panel.
describe('navigation (ADR 0062)', () => {
  it('gives a worktree only Dashboard, Changes, Pull request, Sessions and Explorer (ADR 0064)', () => {
    useNavigation.getState().ensurePanelTabs('w1')
    expect(useNavigation.getState().panelTabs.w1?.map((t) => t.kind)).toEqual(['workspace', 'changes', 'pull', 'sessions', 'explorer'])
  })

  it('opens Settings on one Workspace and returns to what was behind', () => {
    const nav = useNavigation.getState()
    nav.openWorkspace('p1', 'w1')
    nav.openSettings('workspace', 'p1')
    expect(useNavigation.getState().view).toMatchObject({ type: 'settings', section: 'workspace', projectId: 'p1', returnTo: { type: 'workspace', workspaceId: 'w1' } })
    // Another section drops the Workspace.
    nav.openSettings('keyboard')
    expect(useNavigation.getState().view).not.toHaveProperty('projectId')
    nav.closeSettings()
    expect(useNavigation.getState().view).toMatchObject({ type: 'workspace', workspaceId: 'w1' })
  })

  it('opens Schedules in the main area, outside any Workspace', () => {
    useNavigation.getState().openSchedules()
    const { view } = useNavigation.getState()
    expect(view).toEqual({ type: 'schedules' })
    expect(selectedProjectId(view)).toBeUndefined()
  })
})
