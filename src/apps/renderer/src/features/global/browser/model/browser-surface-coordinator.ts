type BrowserSurfaceListener = (suspended: boolean) => void

const blockers = new Set<symbol>()
const listeners = new Set<BrowserSurfaceListener>()

function notify(): void {
  const suspended = blockers.size > 0
  for (const listener of listeners) listener(suspended)
}

export function acquireBrowserSurfaceBlocker(source: string): () => void {
  const token = Symbol(source)
  const wasSuspended = blockers.size > 0
  blockers.add(token)
  if (!wasSuspended) notify()

  let released = false
  return () => {
    if (released) return
    released = true
    const wasBlocked = blockers.size > 0
    blockers.delete(token)
    if (wasBlocked && blockers.size === 0) notify()
  }
}

export function areBrowserSurfacesSuspended(): boolean {
  return blockers.size > 0
}

export function subscribeBrowserSurfaceSuspension(listener: BrowserSurfaceListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
