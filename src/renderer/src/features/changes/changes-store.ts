import { create } from 'zustand'
import type { ChangeSource } from '@shared/domain/changes'
import { api } from '../../lib/api'
import { useLayouts } from '../../stores/data'
import { runAction } from '../../stores/notices'
import { useNavigation } from '../../stores/navigation'

interface ChangesView {
  /** What each worktree's Changes tab shows; absent = uncommitted. */
  source: Record<string, ChangeSource>
  setSource(workspaceId: string, source: ChangeSource): void
}

export const useChangesView = create<ChangesView>((set) => ({
  source: {},
  setSource: (workspaceId, source) => set((s) => ({ source: { ...s.source, [workspaceId]: source } }))
}))

/** Opens the worktree's Changes tab, on `source` when given (a turn's changes, ADR 0058). */
export const showChanges = (workspaceId: string, source?: ChangeSource): void => {
  if (source) useChangesView.getState().setSource(workspaceId, source)
  useNavigation.getState().showPanelTab(workspaceId, 'changes')
}

/** Opens (or brings forward) the worktree's review pane: every changed file's diff (ADR 0064). */
export const openReview = async (workspaceId: string): Promise<void> => {
  const pane = await runAction('Review changes', () => api('editors.openReview', { workspaceId }))
  if (pane) void useLayouts.getState().apply(workspaceId, { type: 'activate', paneId: pane.id })
}
