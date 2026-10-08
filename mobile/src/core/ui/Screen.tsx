import type { ReactNode } from 'react'
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { ChevronDown, ChevronRight } from 'lucide-react-native'
import { gutter, pageX, space, touch, useTheme } from '../theme'
import { Text } from './Text'

export interface ScreenProps {
  children: ReactNode
  /** Pull to refresh. */
  onRefresh?: () => void
  refreshing?: boolean
  /** Fixed content (a terminal) instead of a scrolling page. */
  fixed?: boolean
}

/** A page: the theme background, side margins, air between its surfaces, pull to refresh. */
export function Screen({ children, onRefresh, refreshing = false, fixed }: ScreenProps) {
  const { colors } = useTheme()
  if (fixed) return <View style={[styles.fill, { backgroundColor: colors.bg }]}>{children}</View>
  return (
    <ScrollView
      style={{ backgroundColor: colors.bg }}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} /> : undefined}
    >
      {children}
    </ScrollView>
  )
}

export interface SectionProps {
  title?: string
  children: ReactNode
  aside?: ReactNode
  /** With `onToggle`, the title folds the section away and back (its `aside` stays). */
  collapsed?: boolean
  onToggle?: () => void
}

/** A titled group of surfaces on a page; foldable when it has `onToggle`. */
export function Section({ title, children, aside, collapsed = false, onToggle }: SectionProps) {
  const { colors } = useTheme()
  const Chevron = collapsed ? ChevronRight : ChevronDown
  const heading = title ? (
    <Text variant="overline" tone="muted" accessibilityRole={onToggle ? undefined : 'header'}>
      {title}
    </Text>
  ) : null
  return (
    <View style={styles.section}>
      {title || aside ? (
        <View style={styles.sectionHead}>
          {onToggle ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={title}
              accessibilityState={{ expanded: !collapsed }}
              hitSlop={space[5]}
              onPress={onToggle}
              style={styles.toggle}
            >
              {heading}
              <Chevron size={16} color={colors.textMuted} />
            </Pressable>
          ) : (
            heading
          )}
          {aside}
        </View>
      ) : null}
      {collapsed ? null : <View style={styles.stack}>{children}</View>}
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: pageX, paddingTop: space[5], paddingBottom: space[11], gap: space[9] },
  section: { gap: space[5] },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[2] },
  stack: { gap: gutter },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: space[2], minHeight: touch }
})
