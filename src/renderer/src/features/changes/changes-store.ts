import { create } from 'zustand'
import type { ChangeSource } from '@shared/domain/changes'
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
