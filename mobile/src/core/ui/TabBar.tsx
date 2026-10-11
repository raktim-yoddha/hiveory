import { Pressable, StyleSheet, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Haptics from 'expo-haptics'
import type { BottomTabBarProps } from 'expo-router/js-tabs'
import { font, radius, space, useTheme } from '../theme'
import { Text } from './Text'

/**
 * The phone's bottom navigation (ADR 0039): five places, each a pill that holds its icon and its
 * label together, so the selected tab reads as one shape (not a dot behind the icon only). Badges
 * (what needs you) sit on the icon.
 */
export function TabBar({ state, descriptors, navigation }: BottomTabBarProps) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  return (
    <View style={[styles.bar, { backgroundColor: colors.surface, borderTopColor: colors.border, paddingBottom: Math.max(insets.bottom, space[4]) }]} accessibilityRole="tablist">
      {state.routes.map((route, index) => {
        const { options } = descriptors[route.key]!
        const selected = state.index === index
        const label = typeof options.title === 'string' ? options.title : route.name
        const color = selected ? colors.accent : colors.textMuted
        const badge = options.tabBarBadge
        return (
          <Pressable
            key={route.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={badge ? `${label}, ${badge} need you` : label}
            onPress={() => {
              const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true })
              if (!selected && !event.defaultPrevented) {
                void Haptics.selectionAsync()
                navigation.navigate(route.name, route.params)
              }
            }}
            style={styles.slot}
          >
            <View style={[styles.pill, selected && { backgroundColor: colors.brandSoft }]}>
              <View>
                {options.tabBarIcon?.({ focused: selected, color, size: 20 })}
                {badge ? (
                  <View style={[styles.badge, { backgroundColor: colors.waiting }]}>
                    <Text style={[styles.badgeText, { color: colors.accentContrast }]}>{String(badge)}</Text>
                  </View>
                ) : null}
              </View>
              <Text style={[styles.label, { color }]} numberOfLines={1}>
                {label}
              </Text>
            </View>
          </Pressable>
        )
      })}
    </View>
  )
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', paddingTop: space[4], paddingHorizontal: space[3], borderTopWidth: StyleSheet.hairlineWidth },
  slot: { flex: 1, alignItems: 'center' },
  pill: { alignItems: 'center', gap: space[1], minWidth: 60, paddingHorizontal: space[5], paddingVertical: space[3], borderRadius: radius.md },
  label: { fontSize: font.size.caption, fontWeight: font.weight.semibold },
  badge: { position: 'absolute', top: -space[2], right: -space[5], minWidth: 16, height: 16, paddingHorizontal: space[2], borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 10, fontWeight: font.weight.bold }
})
