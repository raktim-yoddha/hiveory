import { useLocalSearchParams } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { PullRequestsScreen } from '@/features/projects'

export { RouteErrorBoundary as ErrorBoundary }

export default function PullRequestsRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  return <PullRequestsScreen projectId={projectId} />
}
