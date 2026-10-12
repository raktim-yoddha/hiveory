import { Pressable, ScrollView, StyleSheet, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { CornerDownLeft } from 'lucide-react-native'
import { KEYS, type Modifiers } from '@/core/terminal'
import { radius, space, touch, useTheme } from '@/core/theme'
import { Text } from '@/core/ui'

type Key = { key: keyof typeof KEYS; label: string; spoken: string } | { mod: keyof Modifiers; label: string; spoken: string }

const KEY_ROW: Key[] = [
  { key: 'escape', label: 'Esc', spoken: 'Escape' },
  { key: 'tab', label: 'Tab', spoken: 'Tab' },
  { mod: 'ctrl', label: 'Ctrl', spoken: 'Control' },
  { mod: 'alt', label: 'Alt', spoken: 'Alt' },
  { key: 'left', label: '←', spoken: 'Left' },
  { key: 'up', label: '↑', spoken: 'Up' },
  { key: 'down', label: '↓', spoken: 'Down' },
  { key: 'right', label: '→', spoken: 'Right' },
  { key: 'slash', label: '/', spoken: 'Slash' }
]

const tap = (): void => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

/**
 * The keys a phone keyboard lacks, in one row right above it (ADR 0039, 0048): Esc, Tab, Ctrl and Alt
 * (held for the next key, typed or tapped), the arrows and /, scrolling sideways when the screen is
 * narrow, and Enter fixed at the right end, which sends the prompt (the keyboard's own Enter adds a line).
 * Taps never close the keyboard.
 */
export function KeyBar({
  onKey,
  onEnter,
  modifiers,
  onModifiers
}: {
  onKey: (bytes: string) => void
  onEnter: () => void
  modifiers: Modifiers
  onModifiers: (next: Modifiers) => void
}) {
  const { colors } = useTheme()
  return (
    <View style={styles.row}>
      <ScrollView horizontal keyboardShouldPersistTaps="always" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.keys} style={styles.scroller}>
        {KEY_ROW.map((k) => {
          const held = 'mod' in k && modifiers[k.mod]
          return (
            <Pressable
              key={k.label}
              accessibilityRole={'mod' in k ? 'togglebutton' : 'button'}
              accessibilityLabel={'mod' in k ? `Hold ${k.spoken} for the next key` : `Press ${k.spoken}`}
              accessibilityState={'mod' in k ? { checked: held } : undefined}
              onPress={() => {
                tap()
                if ('mod' in k) onModifiers({ ...modifiers, [k.mod]: !modifiers[k.mod] })
                else onKey(KEYS[k.key])
              }}
              style={({ pressed }) => [styles.key, { backgroundColor: held ? colors.accent : pressed ? colors.surfaceActive : colors.surfaceRaised }]}
            >
              <Text variant="label" style={[styles.keyText, held ? { color: colors.accentContrast } : null]}>
                {k.label}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>
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
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingRight: space[5] },
  scroller: { flex: 1 },
  keys: { flexDirection: 'row', gap: space[3], paddingLeft: space[5] },
  key: { minWidth: touch, height: 34, paddingHorizontal: space[4], borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 15, fontWeight: '600' },
  enter: { width: 52, height: 34, borderRadius: radius.sm, alignItems: 'center', justifyContent: 'center' }
})
