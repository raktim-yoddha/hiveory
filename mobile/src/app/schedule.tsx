import { useLocalSearchParams } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { ScheduleEditScreen } from '@/features/schedules'

export { RouteErrorBoundary as ErrorBoundary }

export default function ScheduleRoute() {
  const { routineId, projectId } = useLocalSearchParams<{ routineId?: string; projectId?: string }>()
  return <ScheduleEditScreen routineId={routineId} projectId={projectId} />
}
