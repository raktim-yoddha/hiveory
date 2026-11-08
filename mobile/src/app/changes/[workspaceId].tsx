import { useLocalSearchParams } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { ChangesScreen } from '@/features/changes'

export { RouteErrorBoundary as ErrorBoundary }

export default function ChangesRoute() {
  const { workspaceId } = useLocalSearchParams<{ workspaceId: string }>()
  return <ChangesScreen workspaceId={workspaceId} />
}
