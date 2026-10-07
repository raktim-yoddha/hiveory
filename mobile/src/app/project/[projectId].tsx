import { useLocalSearchParams } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { ProjectScreen } from '@/features/projects'

export { RouteErrorBoundary as ErrorBoundary }

export default function ProjectRoute() {
  const { projectId } = useLocalSearchParams<{ projectId: string }>()
  return <ProjectScreen projectId={projectId} />
}
