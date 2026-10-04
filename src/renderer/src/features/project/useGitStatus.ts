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
    const timer = setInterval(load, REFRESH_MS)
    return () => {
      disposed = true
      clearInterval(timer)
    }
  }, [workspaceId, enabled])
  return status
}
