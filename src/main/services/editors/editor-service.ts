import { randomBytes } from 'node:crypto'
import { basename } from 'node:path'
import type { EditorView } from '@shared/domain'
import { fail } from '@shared/errors'
import { dockPane, insertBeside, listPanes } from '@shared/layout/operations'
import type { Placement } from '../agents/agent-service'
import type { Emit } from '../events'
import type { LayoutService } from '../layout/layout-service'
import type { StateStore } from '../persistence/state-store'
import type { StoredEditor } from '../persistence/schema'

/**
 * Files open as panes in a Workspace (double-click in the Explorer). They
 * share the pane layout with agents: same splits, drag, swap and maximize.
 * One pane per file; opening it again just returns that pane.
 */
export class EditorService {
  constructor(
    private readonly store: StateStore,
    private readonly layouts: LayoutService,
    /** Every pane id of a workspace (agents and editors), for layout reconciliation. */
    private readonly paneIds: (workspaceId: string) => string[],
    private readonly emit: Emit
  ) {}

  private view(editor: StoredEditor): EditorView {
    return { ...editor, name: basename(editor.path) }
  }

  list(workspaceId: string): EditorView[] {
    return this.store.state.editors.filter((e) => e.workspaceId === workspaceId).map((e) => this.view(e))
  }

  /** Pane ids of the workspace's open files. */
  ids(workspaceId: string): string[] {
    return this.store.state.editors.filter((e) => e.workspaceId === workspaceId).map((e) => e.id)
  }

  open(workspaceId: string, path: string, placement?: Placement): EditorView {
    const existing = this.store.state.editors.find((e) => e.workspaceId === workspaceId && e.path === path)
    if (existing) return this.view(existing)
    const editor: StoredEditor = { id: `e${randomBytes(6).toString('hex')}`, workspaceId, path }
    const tree = this.layouts.get(workspaceId, this.paneIds(workspaceId))
    this.store.update((s) => {
      s.editors.push(editor)
    })
    const next =
      placement && listPanes(tree).includes(placement.targetPaneId)
        ? insertBeside(tree, editor.id, placement.targetPaneId, placement.side)
        : dockPane(tree, editor.id, 'right')
    this.layouts.set(workspaceId, next)
    this.emit('state.changed', { topic: 'editors', workspaceId })
    return this.view(editor)
  }

  close(editorId: string): void {
    const editor = this.store.state.editors.find((e) => e.id === editorId)
    if (!editor) fail('NOT_FOUND', 'That file is not open.')
    this.store.update((s) => {
      s.editors = s.editors.filter((e) => e.id !== editorId)
    })
    this.layouts.get(editor!.workspaceId, this.paneIds(editor!.workspaceId))
    this.emit('state.changed', { topic: 'editors', workspaceId: editor!.workspaceId })
    this.emit('state.changed', { topic: 'layout', workspaceId: editor!.workspaceId })
  }

  /** Keeps open panes pointing at a file that was renamed or moved (and its children for folders). */
  renamed(workspaceId: string, from: string, to: string): void {
    let changed = false
    this.store.update((s) => {
      for (const e of s.editors) {
        if (e.workspaceId !== workspaceId) continue
        if (e.path === from || e.path.startsWith(`${from}/`)) {
          e.path = to + e.path.slice(from.length)
          changed = true
        }
      }
    })
    if (changed) this.emit('state.changed', { topic: 'editors', workspaceId })
  }

  /** Drops every editor of a workspace (it was deleted or removed). */
  forgetWorkspace(workspaceId: string): void {
    this.store.update((s) => {
      s.editors = s.editors.filter((e) => e.workspaceId !== workspaceId)
    })
  }
}
