import { Pressable, ScrollView, StyleSheet } from 'react-native'
import * as Haptics from 'expo-haptics'
import { KEYS } from '@/core/terminal'
import { radius, space, useTheme } from '@/core/theme'
import { Text } from '@/core/ui'

const KEY_ROW: { key: keyof typeof KEYS; label: string; spoken: string }[] = [
  { key: 'escape', label: 'Esc', spoken: 'Escape' },
  { key: 'tab', label: 'Tab', spoken: 'Tab' },
  { key: 'slash', label: '/', spoken: 'Slash' },
  { key: 'up', label: '↑', spoken: 'Up' },
  { key: 'down', label: '↓', spoken: 'Down' },
  { key: 'left', label: '←', spoken: 'Left' },
  { key: 'right', label: '→', spoken: 'Right' },
  { key: 'interrupt', label: '^C', spoken: 'Control C' },
  { key: 'enter', label: '⏎', spoken: 'Enter' }
]

/** The keys a phone keyboard lacks, one tap each, sent straight to the terminal. */
export function KeyBar({ onKey }: { onKey: (bytes: string) => void }) {
  const { colors } = useTheme()
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="always">
      {KEY_ROW.map(({ key, label, spoken }) => (
        <Pressable
          key={key}
          accessibilityRole="button"
          accessibilityLabel={`Press ${spoken}`}
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
            onKey(KEYS[key])
          }}
          style={({ pressed }) => [styles.key, { backgroundColor: pressed ? colors.surfaceActive : colors.surfaceRaised }]}
        >
          <Text variant="label" style={styles.keyText}>
            {label}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: { gap: space[3], paddingHorizontal: space[5] },
  key: { minWidth: 48, height: 38, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space[5] },
  keyText: { fontSize: 15, fontWeight: '600' }
})
