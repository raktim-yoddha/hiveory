import { useLocalSearchParams } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { ProjectSettingsScreen } from '@/features/projects'

export { RouteErrorBoundary as ErrorBoundary }

export default function ProjectSettingsRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  return <ProjectSettingsScreen projectId={projectId} />
}
