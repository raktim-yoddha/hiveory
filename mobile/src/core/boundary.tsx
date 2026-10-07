import { Component, type ReactNode } from 'react'
import type { ErrorBoundaryProps } from 'expo-router'
import { StyleSheet, View } from 'react-native'
import { TriangleAlert } from 'lucide-react-native'
import { space, useTheme } from './theme'
import { Button, EmptyState, Text } from './ui'

/**
 * Every route exports this as its ErrorBoundary (Expo Router), so a feature
 * that crashes shows this inside its own screen: tabs, other screens and the
 * connection keep working (AGENTS.md: one feature breaking never breaks another).
 */
export function RouteErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const { colors } = useTheme()
  return (
    <View style={[styles.fill, { backgroundColor: colors.bg }]}>
      <EmptyState icon={TriangleAlert} title="This screen hit a problem" body="The rest of the app still works." action={<Button label="Try again" variant="primary" onPress={() => void retry()} />} />
      <Text variant="mono" tone="muted" style={styles.detail} numberOfLines={4}>
        {error.message}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'center' },
  detail: { textAlign: 'center', paddingHorizontal: space[9] }
})

/**
 * For app-wide layers that are not screens (SSH questions, notification taps,
 * notices): if one fails it shows nothing and is logged, and every screen keeps
 * working. A layer must never take the app down with it.
 */
export class LayerBoundary extends Component<{ name: string; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: Error): void {
    console.warn(`${this.props.name} stopped working; the rest of the app continues`, error)
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}
