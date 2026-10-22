import { Stack } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { SchedulesScreen } from '@/features/schedules'

export { RouteErrorBoundary as ErrorBoundary }

export default function SchedulesRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Schedules' }} />
      <SchedulesScreen />
    </>
  )
}
