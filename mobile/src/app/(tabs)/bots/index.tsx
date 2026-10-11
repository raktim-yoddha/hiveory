import { StyleSheet, View } from 'react-native'
import { RouteErrorBoundary } from '@/core/boundary'
import { ConnectionBanner } from '@/core/ConnectionBanner'
import { BotsScreen } from '@/features/bots'

export { RouteErrorBoundary as ErrorBoundary }

export default function BotsRoute() {
  return (
    <View style={styles.fill}>
      <ConnectionBanner />
      <BotsScreen />
    </View>
  )
}

const styles = StyleSheet.create({ fill: { flex: 1 } })
