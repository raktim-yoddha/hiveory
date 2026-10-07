import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { space, useTheme } from '../theme'
import { Text } from './Text'

/** A screen waiting for its first answer from the computer. */
export function Loading({ label = 'Loading…' }: { label?: string }) {
  const { colors } = useTheme()
  return (
    <View style={styles.wrap} accessibilityLabel={label} accessibilityRole="progressbar">
      <ActivityIndicator color={colors.accent} />
      <Text tone="muted" variant="label">
        {label}
      </Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: space[5], paddingVertical: space[11] }
})
