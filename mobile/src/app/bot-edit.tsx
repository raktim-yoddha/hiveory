import { useLocalSearchParams } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { BotEditScreen } from '@/features/bots'

export { RouteErrorBoundary as ErrorBoundary }

export default function BotEditRoute() {
  const { botId } = useLocalSearchParams<{ botId?: string }>()
  return <BotEditScreen botId={botId} />
}
