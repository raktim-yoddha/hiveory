import { create } from 'zustand'
import type { EditorView } from '@shared/domain'
import { api } from '../lib/api'
import { reportError } from './notices'

interface EditorsState {
  byWorkspace: Record<string, EditorView[]>
  /** Open files with unsaved changes, so their tab can say so. */
  unsaved: Record<string, true>
  /** Where an open file should jump to (a terminal link with a line), until its editor has. */
  reveal: Record<string, { line: number; col: number }>
  load(workspaceId: string): Promise<void>
  setUnsaved(editorId: string, unsaved: boolean): void
  revealAt(editorId: string, line: number, col: number): void
  revealed(editorId: string): void
}

/** Files open as panes, per workspace (main owns the list and the layout). */
export const useEditors = create<EditorsState>((set) => ({
  byWorkspace: {},
  unsaved: {},
  reveal: {},
  revealAt: (editorId, line, col) => set((s) => ({ reveal: { ...s.reveal, [editorId]: { line, col } } })),
  revealed: (editorId) =>
    set((s) => {
      if (!s.reveal[editorId]) return s
      const next = { ...s.reveal }
      delete next[editorId]
      return { reveal: next }
    }),
  setUnsaved:(editorId, unsaved) =>
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
