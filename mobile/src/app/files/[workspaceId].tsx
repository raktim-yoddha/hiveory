import { useLocalSearchParams } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { FilesScreen } from '@/features/files'

export { RouteErrorBoundary as ErrorBoundary }

export default function FilesRoute() {
  const { workspaceId, projectId, dir } = useLocalSearchParams<{ workspaceId: string; projectId: string; dir?: string }>()
  return <FilesScreen workspaceId={workspaceId} projectId={projectId} dir={dir ?? ''} />
}
