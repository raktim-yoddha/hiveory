import { useId, useLayoutEffect } from 'react'
import { acquireBrowserSurfaceBlocker } from '../model/browser-surface-coordinator'

export function useBrowserSurfaceBlocker(active: boolean, source: string): void {
  const instanceId = useId()

  useLayoutEffect(() => {
    if (!active) return
    return acquireBrowserSurfaceBlocker(`${source}:${instanceId}`)
  }, [active, instanceId, source])
}
