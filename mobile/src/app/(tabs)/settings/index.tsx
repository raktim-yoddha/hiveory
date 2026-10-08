import { RouteErrorBoundary } from '@/core/boundary'
import { PushToggle } from '@/features/notifications'
import { SettingsScreen } from '@/features/settings'
import { UpdateControls } from '@/features/updates'

export { RouteErrorBoundary as ErrorBoundary }

export default function SettingsRoute() {
  return <SettingsScreen notifications={<PushToggle />} updates={<UpdateControls />} />
}
