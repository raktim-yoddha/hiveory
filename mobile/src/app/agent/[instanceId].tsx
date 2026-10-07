import { useLocalSearchParams } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { AgentScreen } from '@/features/agent'

export { RouteErrorBoundary as ErrorBoundary }

export default function AgentRoute() {
  const { instanceId, workspaceId } = useLocalSearchParams<{ instanceId: string; workspaceId: string }>()
  return <AgentScreen instanceId={instanceId} workspaceId={workspaceId} />
}
