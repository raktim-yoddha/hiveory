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
