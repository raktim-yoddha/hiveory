import { create } from 'zustand'
import type { EditorView } from '@shared/domain'
import { api } from '../lib/api'
import { reportError } from './notices'

interface EditorsState {
  byWorkspace: Record<string, EditorView[]>
  load(workspaceId: string): Promise<void>
}

/** Files open as panes, per workspace (main owns the list and the layout). */
export const useEditors = create<EditorsState>((set) => ({
  byWorkspace: {},
  load: async (workspaceId) => {
    try {
      const editors = await api('editors.list', { workspaceId })
      set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: editors } }))
    } catch (error) {
      reportError(error, 'Load open files')
    }
  }
}))
