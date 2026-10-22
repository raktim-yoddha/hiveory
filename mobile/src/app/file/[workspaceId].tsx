import { useLocalSearchParams } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { FileScreen } from '@/features/files'

export { RouteErrorBoundary as ErrorBoundary }

export default function FileRoute() {
  const { workspaceId, path } = useLocalSearchParams<{ workspaceId: string; path: string }>()
  return <FileScreen workspaceId={workspaceId} path={path} />
}
