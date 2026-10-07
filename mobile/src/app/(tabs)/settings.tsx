import { RouteErrorBoundary } from '@/core/boundary'
import { PushToggle } from '@/features/notifications'
import { SettingsScreen } from '@/features/settings'

export { RouteErrorBoundary as ErrorBoundary }

export default function SettingsRoute() {
  return <SettingsScreen notifications={<PushToggle />} />
}
