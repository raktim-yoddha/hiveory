import type { LayoutNode, LayoutOperation } from '@shared/domain'
import { applyOperation, dockPane, listPanes, removePane } from '@shared/layout/operations'
import type { Emit } from '../events'
import type { StateStore } from '../persistence/state-store'

/** Persists per-Workspace pane layouts and applies layout operations (architecture.md "Pane Layout"). */
export class LayoutService {
  constructor(
    private readonly store: StateStore,
    private readonly emit: Emit
  ) {}

  /**
   * Returns the layout reconciled with the Workspace's instances: panes of
   * missing instances are dropped, unplaced instances are docked right.
   */
  get(workspaceId: string, paneIds: string[]): LayoutNode | null {
    const stored = this.store.state.layouts[workspaceId] ?? null
    const wanted = new Set(paneIds)
    let tree = listPanes(stored).reduce((t, id) => (wanted.has(id) ? t : removePane(t, id)), stored)
    const placed = new Set(listPanes(tree))
    for (const id of paneIds) if (!placed.has(id)) tree = dockPane(tree, id, 'right')
    if (JSON.stringify(tree) !== JSON.stringify(stored)) this.set(workspaceId, tree, false)
    return tree
  }

  apply(workspaceId: string, paneIds: string[], operation: LayoutOperation): LayoutNode | null {
    const next = applyOperation(this.get(workspaceId, paneIds), operation)
    this.set(workspaceId, next)
    return next
  }

  set(workspaceId: string, tree: LayoutNode | null, notify = true): void {
    this.store.update((s) => {
      if (tree) s.layouts[workspaceId] = tree
      else delete s.layouts[workspaceId]
    })
    if (notify) this.emit('state.changed', { topic: 'layout', workspaceId })
  }
}
