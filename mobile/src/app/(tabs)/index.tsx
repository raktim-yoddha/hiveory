import { StyleSheet, View } from 'react-native'
import { RouteErrorBoundary } from '@/core/boundary'
import { ConnectionBanner } from '@/core/ConnectionBanner'
import { InboxScreen } from '@/features/inbox'
import { PushSuggestion } from '@/features/notifications'

export { RouteErrorBoundary as ErrorBoundary }

export default function InboxRoute() {
  return (
    <View style={styles.fill}>
      <ConnectionBanner />
      <InboxScreen aside={<PushSuggestion />} />
    </View>
  )
}

const styles = StyleSheet.create({ fill: { flex: 1 } })
