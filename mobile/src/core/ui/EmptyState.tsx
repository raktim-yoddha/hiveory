import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { radius, space, useTheme } from '../theme'
import type { IconComponent } from './Button'
import { Text } from './Text'

/**
 * What a screen shows when there is nothing yet, always with the next step. `compact` sits inside a
 * page between other content; the default fills an otherwise empty screen.
 */
export function EmptyState({ icon: Icon, title, body, action, compact }: { icon: IconComponent; title: string; body?: string; action?: ReactNode; compact?: boolean }) {
  const { colors } = useTheme()
  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <View style={[styles.icon, { backgroundColor: colors.surfaceRaised }]}>
        <Icon size={24} color={colors.accent} strokeWidth={1.8} />
      </View>
      <Text variant="lead" style={styles.center}>
        {title}
      </Text>
      {body ? (
        <Text tone="muted" style={[styles.center, styles.body]}>
          {body}
        </Text>
      ) : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space[3], paddingVertical: space[11], paddingHorizontal: space[7] },
  compact: { paddingVertical: space[9] },
  icon: { width: 52, height: 52, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: space[4] },
  center: { textAlign: 'center' },
  // A readable measure on wide phones; balanced breaking handles the narrow ones.
  body: { maxWidth: 300 },
  action: { marginTop: space[5] }
})
