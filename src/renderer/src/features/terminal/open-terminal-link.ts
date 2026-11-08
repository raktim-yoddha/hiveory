import { api } from '../../lib/api'
import { useEditors } from '../../stores/editors'
import { useNotices, runAction } from '../../stores/notices'
import { openBrowserPane } from '../browser/open-browser'
import { pathInWorktree, type TerminalLink } from './terminal-links'

export interface LinkPlace {
  workspaceId: string
  /** The worktree's folder, where relative paths in the output are read from. */
  root: string
  /** The terminal's pane: what opens goes beside it. */
  paneId: string
}

/**
 * Opens what a terminal link points at, beside its terminal: a web address in a browser pane, a file of
 * the worktree in an editor pane at its line. Files outside the worktree are never opened.
 */
export async function openTerminalLink(link: TerminalLink, place: LinkPlace): Promise<void> {
  if (link.kind === 'url') {
    if (/^https?:\/\//i.test(link.url)) await openBrowserPane(place.workspaceId, { url: link.url, beside: { paneId: place.paneId, side: 'right' } })
    return
  }
  const path = pathInWorktree(link.path, place.root)
  if (!path) {
    useNotices.getState().push({ level: 'warning', message: `${link.path} is outside this worktree, so it opens only from your file manager.` })
    return
  }
  const scope = { workspaceId: place.workspaceId }
  // A name that only looks like a file (or a file since deleted) says so instead of opening an empty pane.
  const exists = await api('files.read', { scope, path }).then(
    () => true,
    () => false
  )
  if (!exists) {
    useNotices.getState().push({ level: 'warning', message: `No file ${path} in this worktree.` })
    return
  }
  const editor = await runAction('Open file', () => api('editors.open', { workspaceId: place.workspaceId, path, targetPaneId: place.paneId, side: 'right' }))
  if (!editor) return
  await api('layout.apply', { workspaceId: place.workspaceId, operation: { type: 'activate', paneId: editor.id } }).catch(() => undefined)
  if (link.line) useEditors.getState().revealAt(editor.id, link.line, link.col ?? 1)
}
