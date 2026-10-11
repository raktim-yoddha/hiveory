import { Pressable, StyleSheet, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { CornerDownLeft } from 'lucide-react-native'
import { KEYS } from '@/core/terminal'
import { radius, space, useTheme } from '@/core/theme'
import { Text } from '@/core/ui'

const KEY_ROW: { key: keyof typeof KEYS; label: string; spoken: string }[] = [
  { key: 'slash', label: '/', spoken: 'Slash' },
  { key: 'escape', label: 'Esc', spoken: 'Escape' },
  { key: 'tab', label: 'Tab', spoken: 'Tab' },
  { key: 'up', label: '↑', spoken: 'Up' },
  { key: 'down', label: '↓', spoken: 'Down' }
]

const tap = (): void => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

/**
 * The few keys a phone keyboard lacks, in one slim row right above it (ADR 0039): /, Esc, Tab, ↑ and ↓,
 * and Enter fixed at the right end, which sends the prompt (the keyboard's own Enter adds a line).
 */
export function KeyBar({ onKey, onEnter }: { onKey: (bytes: string) => void; onEnter: () => void }) {
  const { colors } = useTheme()
  return (
    <View style={styles.row}>
      <View style={styles.keys}>
        {KEY_ROW.map(({ key, label, spoken }) => (
          <Pressable
            key={key}
            accessibilityRole="button"
            accessibilityLabel={`Press ${spoken}`}
            onPress={() => {
              tap()
              onKey(KEYS[key])
            }}
            style={({ pressed }) => [styles.key, { backgroundColor: pressed ? colors.surfaceActive : colors.surfaceRaised }]}
          >
            <Text variant="label" style={styles.keyText}>
              {label}
            </Text>
          </Pressable>
        ))}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Press Enter"
        onPress={() => {
          tap()
          onEnter()
        }}
        style={({ pressed }) => [styles.enter, { backgroundColor: colors.accent, opacity: pressed ? 0.8 : 1 }]}
      >
        <CornerDownLeft size={18} color={colors.accentContrast} strokeWidth={2.2} />
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingHorizontal: space[5] },
  keys: { flex: 1, flexDirection: 'row', gap: space[3] },
  key: { flex: 1, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 15, fontWeight: '600' },
  enter: { width: 52, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }
})
