import { useLocalSearchParams } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { ChatScreen } from '@/features/chats'

export { RouteErrorBoundary as ErrorBoundary }

export default function ChatRoute() {
  const { chatId } = useLocalSearchParams<{ chatId: string }>()
  return <ChatScreen chatId={chatId} />
}
