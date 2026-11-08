import { Stack } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { UsageScreen } from '@/features/usage'

export { RouteErrorBoundary as ErrorBoundary }

export default function UsageRoute() {
  return (
    <>
      <Stack.Screen options={{ title: 'Usage' }} />
      <UsageScreen />
    </>
  )
}
