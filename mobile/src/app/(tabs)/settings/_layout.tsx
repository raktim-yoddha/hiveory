import { RouteErrorBoundary } from '@/core/boundary'
import { TabStack } from '@/core/ui'

export { RouteErrorBoundary as ErrorBoundary }

export default function SettingsStack() {
  return <TabStack title="Settings" />
}
