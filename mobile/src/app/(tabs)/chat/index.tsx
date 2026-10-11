import { StyleSheet, View } from 'react-native'
import { RouteErrorBoundary } from '@/core/boundary'
import { ConnectionBanner } from '@/core/ConnectionBanner'
import { ChatsScreen } from '@/features/chats'

export { RouteErrorBoundary as ErrorBoundary }

export default function ChatRoute() {
  return (
    <View style={styles.fill}>
      <ConnectionBanner />
      <ChatsScreen />
    </View>
  )
}

const styles = StyleSheet.create({ fill: { flex: 1 } })
