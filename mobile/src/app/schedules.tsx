import { Stack, useLocalSearchParams } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { SchedulesScreen } from '@/features/schedules'

export { RouteErrorBoundary as ErrorBoundary }

export default function SchedulesRoute() {
  const { projectId } = useLocalSearchParams<{ projectId?: string }>()
  return (
    <>
      <Stack.Screen options={{ title: 'Schedules' }} />
      <SchedulesScreen projectId={projectId} />
    </>
  )
}
