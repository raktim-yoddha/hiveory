import { useLocalSearchParams } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { BotScreen } from '@/features/bots'

export { RouteErrorBoundary as ErrorBoundary }

export default function BotRoute() {
  const { botId } = useLocalSearchParams<{ botId: string }>()
  return <BotScreen botId={botId} />
}
