import type { ReactNode } from 'react'
import { StyleSheet, View } from 'react-native'
import { radius, space, useTheme } from '../theme'
import type { IconComponent } from './Button'
import { Text } from './Text'

/** What a screen shows when there is nothing yet, always with the next step. */
export function EmptyState({ icon: Icon, title, body, action }: { icon: IconComponent; title: string; body?: string; action?: ReactNode }) {
  const { colors } = useTheme()
  return (
    <View style={styles.wrap}>
      <View style={[styles.icon, { backgroundColor: colors.surfaceRaised }]}>
        <Icon size={26} color={colors.accent} strokeWidth={1.8} />
      </View>
      <Text variant="lead" style={styles.center}>
        {title}
      </Text>
      {body ? (
        <Text tone="muted" style={styles.center}>
          {body}
        </Text>
      ) : null}
      {action}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space[5], paddingVertical: space[11], paddingHorizontal: space[9] },
  icon: { width: 56, height: 56, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center', marginBottom: space[3] },
  center: { textAlign: 'center' }
})
