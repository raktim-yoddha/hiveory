import { Pressable, StyleSheet, View } from 'react-native'
import { radius, space, useTheme } from '../theme'
import type { IconComponent } from './Button'
import { Text } from './Text'

/** A one-line strip under the header (connection lost, reconnecting). */
export function Banner({ icon: Icon, message, tone = 'waiting', action, onPress }: { icon: IconComponent; message: string; tone?: 'waiting' | 'danger'; action?: string; onPress?: () => void }) {
  const { colors } = useTheme()
  const fg = tone === 'danger' ? colors.danger : colors.waiting
  const bg = tone === 'danger' ? colors.dangerSoft : colors.waitingSoft
  return (
    <Pressable accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={[message, action].filter(Boolean).join('. ')} onPress={onPress} disabled={!onPress} style={[styles.bar, { backgroundColor: bg }]}>
      <Icon size={16} color={fg} />
      <Text variant="label" style={[styles.message, { color: fg }]} numberOfLines={2}>
        {message}
      </Text>
      {action ? (
        <View>
          <Text variant="label" style={{ color: fg, fontWeight: '700' }}>
            {action}
          </Text>
        </View>
      ) : null}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', alignItems: 'center', gap: space[4], paddingHorizontal: space[7], paddingVertical: space[5], borderRadius: radius.md, marginHorizontal: space[7], marginTop: space[3] },
  message: { flex: 1 }
})
