import { GitPullRequest } from 'lucide-react'
import { EmptyState } from '../../components/ui/EmptyState'

/**
 * Placeholder: pull request integration is a documented future boundary
 * (architecture.md "Future Integration Boundary") and not implemented yet.
 */
export function PullRequestsTab() {
  return (
    <EmptyState
      icon={<GitPullRequest />}
      title="Pull requests"
      description="Pull request integration is not connected yet. Hiveory works fully offline with your local repository."
    />
  )
}
