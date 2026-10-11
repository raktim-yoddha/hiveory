import { useCallback, useEffect, useState } from 'react'
import { CODE_HOST_INFO } from '@shared/domain/integrations'
import type { GithubStatus, PullRequest } from '@shared/domain/github'
import type { WorkspaceView } from '@shared/domain'
import { api } from '../../lib/api'
import { runAction, useNotices } from '../../stores/notices'

/** "PR" or "MR" and their long forms, as the Workspace's code host calls them (ADR 0040). */
export const reviewWords = (status: GithubStatus | null): { short: string; long: string; plural: string } =>
  status?.host === 'gitlab' ? { short: 'MR', long: CODE_HOST_INFO.gitlab.review, plural: CODE_HOST_INFO.gitlab.reviews } : { short: 'PR', long: CODE_HOST_INFO.github.review, plural: CODE_HOST_INFO.github.reviews }

/** A Workspace's code host status and open pull (or merge) requests, and opening one from a worktree. */
export function useCodeReview(projectId: string) {
  const [status, setStatus] = useState<GithubStatus | null>(null)
  const [reviews, setReviews] = useState<PullRequest[] | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const next = await api('github.status', { projectId }).catch(() => ({ available: false, reason: 'Could not reach the code host.' }) as GithubStatus)
    setStatus(next)
    setReviews(next.available ? await api('github.pullRequests', { projectId }).catch(() => []) : null)
  }, [projectId])

  useEffect(() => {
    let live = true
    void api('github.status', { projectId })
      .catch(() => ({ available: false, reason: 'Could not reach the code host.' }) as GithubStatus)
      .then(async (next) => {
        if (!live) return
        setStatus(next)
        const list = next.available ? await api('github.pullRequests', { projectId }).catch(() => []) : null
        if (live) setReviews(list)
      })
    return () => {
      live = false
    }
  }, [projectId])

  const create = async (workspace: WorkspaceView, draft = false): Promise<void> => {
    const result = await runAction(`Create ${reviewWords(status).long}`, () => api('github.createPullRequest', { workspaceId: workspace.id, draft }))
    if (!result) return
    useNotices.getState().push({ level: 'info', message: `Opened ${result.url}` })
    await load()
  }

  return { status, reviews, load, create }
}
