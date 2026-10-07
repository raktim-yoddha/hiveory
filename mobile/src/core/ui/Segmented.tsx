import { Pressable, StyleSheet, View } from 'react-native'
import * as Haptics from 'expo-haptics'
import { radius, space, useTheme } from '../theme'
import { Text } from './Text'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  count?: number
}

/** Switches between a few views of the same thing (the board's statuses). Selection is a tinted fill, like the desktop. */
export function Segmented<T extends string>({ options, value, onChange, label }: { options: SegmentOption<T>[]; value: T; onChange: (v: T) => void; label: string }) {
  const { colors } = useTheme()
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={[styles.track, { backgroundColor: colors.surfaceInset }]}>
      {options.map((o) => {
        const on = o.value === value
        return (
          <Pressable
            key={o.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.count === undefined ? o.label : `${o.label}, ${o.count}`}
            onPress={() => {
              if (on) return
              void Haptics.selectionAsync()
              onChange(o.value)
            }}
            style={[styles.option, on && { backgroundColor: colors.surfaceRaised }]}
          >
            <Text variant="label" tone={on ? 'default' : 'muted'} numberOfLines={1}>
              {o.label}
            </Text>
            {o.count !== undefined ? (
              <Text variant="caption" tone={on ? 'accent' : 'muted'}>
                {o.count}
              </Text>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: space[1], borderRadius: radius.md, gap: space[1] },
  option: { flex: 1, minHeight: 36, flexDirection: 'row', gap: space[3], alignItems: 'center', justifyContent: 'center', borderRadius: radius.sm, paddingHorizontal: space[4] }
})
