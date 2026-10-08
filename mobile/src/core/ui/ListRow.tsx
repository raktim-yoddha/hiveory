import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View } from 'react-native'
import { ChevronRight } from 'lucide-react-native'
import { radius, space, useTheme } from '../theme'
import { pressedFill, ripple } from './press'
import { Text } from './Text'

export interface ListRowProps {
  title: string
  subtitle?: string
  leading?: ReactNode
  trailing?: ReactNode
  onPress?: () => void
  /** Overrides the spoken name (defaults to title and subtitle). */
  label?: string
}

/** One tappable line in a list: 56 points tall at least, chevron when it opens something. */
export function ListRow({ title, subtitle, leading, trailing, onPress, label }: ListRowProps) {
  const { colors } = useTheme()
  const body = (
    <>
      {leading}
      <View style={styles.main}>
        <Text variant="lead" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" tone="muted" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {onPress ? <ChevronRight size={18} color={colors.textFaint} /> : null}
    </>
  )
  if (!onPress) return <View style={[styles.row, { backgroundColor: colors.surface }]}>{body}</View>
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label ?? [title, subtitle].filter(Boolean).join(', ')}
      onPress={onPress}
      android_ripple={ripple(colors.surfaceActive)}
      style={({ pressed }) => [styles.row, { backgroundColor: pressedFill(pressed, colors.surfaceHover, colors.surface) }]}
    >
      {body}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  row: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: space[6], paddingHorizontal: space[7], paddingVertical: space[5], borderRadius: radius.lg, overflow: 'hidden' },
  main: { flex: 1, minWidth: 0, gap: space[1] },
  title: { fontSize: 16 }
})
