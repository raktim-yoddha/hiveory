import { RouteErrorBoundary } from '@/core/boundary'
import { TabStack } from '@/core/ui'

export { RouteErrorBoundary as ErrorBoundary }

export default function WorkspacesStack() {
  return <TabStack title="Workspaces" />
}
