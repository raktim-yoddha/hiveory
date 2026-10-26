/**
 * What closing a pane means, registered by each pane while it is mounted (ADR 0042): an agent closes,
 * a file asks about unsaved changes, a browser page closes. The tab strip closes any tab through it.
 */
const closers = new Map<string, () => void>()

export const registerPaneCloser = (paneId: string, close: () => void): (() => void) => {
  closers.set(paneId, close)
  return () => {
    if (closers.get(paneId) === close) closers.delete(paneId)
  }
}

export const closePane = (paneId: string): void => closers.get(paneId)?.()

/** The open worktree's layout maximizes a pane (its double-click, or the shortcut, ADR 0047). */
let maximizer: ((paneId: string) => void) | null = null

export const registerPaneMaximizer = (toggle: (paneId: string) => void): (() => void) => {
  maximizer = toggle
  return () => {
    if (maximizer === toggle) maximizer = null
  }
}

export const togglePaneMaximized = (paneId: string): void => maximizer?.(paneId)
