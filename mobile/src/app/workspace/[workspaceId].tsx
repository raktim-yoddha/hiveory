import { useLocalSearchParams } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { WorkspaceScreen } from '@/features/workspace'

export { RouteErrorBoundary as ErrorBoundary }

export default function WorkspaceRoute() {
  const { workspaceId, projectId } = useLocalSearchParams<{ workspaceId: string; projectId: string }>()
  return <WorkspaceScreen workspaceId={workspaceId} projectId={projectId} />
}
