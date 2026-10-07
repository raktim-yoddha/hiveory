import type { ReactNode } from 'react'
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native'
import { gutter, pageX, space, useTheme } from '../theme'
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

/** A titled group of surfaces on a page. */
export function Section({ title, children, aside }: { title?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <View style={styles.section}>
      {title || aside ? (
        <View style={styles.sectionHead}>
          {title ? (
            <Text variant="overline" tone="muted" accessibilityRole="header">
              {title}
            </Text>
          ) : null}
          {aside}
        </View>
      ) : null}
      <View style={styles.stack}>{children}</View>
    </View>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: pageX, paddingTop: space[5], paddingBottom: space[11], gap: space[9] },
  section: { gap: space[5] },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space[2] },
  stack: { gap: gutter }
})
