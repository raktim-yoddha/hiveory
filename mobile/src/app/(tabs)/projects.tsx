import { StyleSheet, View } from 'react-native'
import { RouteErrorBoundary } from '@/core/boundary'
import { ConnectionBanner } from '@/core/ConnectionBanner'
import { ProjectsScreen } from '@/features/projects'

export { RouteErrorBoundary as ErrorBoundary }

export default function ProjectsRoute() {
  return (
    <View style={styles.fill}>
      <ConnectionBanner />
      <ProjectsScreen />
    </View>
  )
}

const styles = StyleSheet.create({ fill: { flex: 1 } })
