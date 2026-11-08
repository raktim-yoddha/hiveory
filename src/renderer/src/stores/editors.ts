import { create } from 'zustand'
import type { EditorView } from '@shared/domain'
import { api } from '../lib/api'
import { reportError } from './notices'

interface EditorsState {
  byWorkspace: Record<string, EditorView[]>
  /** Open files with unsaved changes, so their tab can say so. */
  unsaved: Record<string, true>
  load(workspaceId: string): Promise<void>
  setUnsaved(editorId: string, unsaved: boolean): void
}

/** Files open as panes, per workspace (main owns the list and the layout). */
export const useEditors = create<EditorsState>((set) => ({
  byWorkspace: {},
  unsaved: {},
  setUnsaved: (editorId, unsaved) =>
    set((s) => {
      if (Boolean(s.unsaved[editorId]) === unsaved) return s
      const next = { ...s.unsaved }
      if (unsaved) next[editorId] = true
      else delete next[editorId]
      return { unsaved: next }
    }),
  load: async (workspaceId) => {
    try {
      const editors = await api('editors.list', { workspaceId })
      set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: editors } }))
    } catch (error) {
      reportError(error, 'Load open files')
    }
  }
}))
