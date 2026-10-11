import { useEffect, useState } from 'react'
import type { GitStatusView } from '@shared/ipc/contract'
import { api } from '../../lib/api'

const REFRESH_MS = 20_000

/** Live branch status of a workspace, refreshed periodically while visible. */
export const useGitStatus = (workspaceId: string, enabled: boolean): GitStatusView | null => {
  const [status, setStatus] = useState<GitStatusView | null>(null)
  useEffect(() => {
    if (!enabled) return
    let disposed = false
    const load = (): void =>
      void api('workspaces.gitStatus', { workspaceId })
        .then((s) => !disposed && setStatus(s))
        .catch(() => undefined)
    load()
    // Not while the window is minimized or hidden (ADR 0044); it catches up when shown again.
    const timer = setInterval(() => !document.hidden && load(), REFRESH_MS)
    const shown = (): void => {
      if (!document.hidden) load()
    }
    document.addEventListener('visibilitychange', shown)
    return () => {
      disposed = true
      clearInterval(timer)
      document.removeEventListener('visibilitychange', shown)
    }
  }, [workspaceId, enabled])
  return status
}
