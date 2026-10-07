import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { radius, space, useTheme } from '../theme'

export interface CardProps {
  children: ReactNode
  onPress?: () => void
  /** Spoken name when the card is pressable. */
  label?: string
  /** `waiting` marks a card that needs the user (the desktop's amber edge). */
  tone?: 'default' | 'waiting'
  style?: StyleProp<ViewStyle>
}

/**
 * A surface with air around it (design.md): flat, no resting outline. Only a
 * card that needs the user gets an edge, in the waiting color.
 */
export function Card({ children, onPress, label, tone = 'default', style }: CardProps) {
  const { colors } = useTheme()
  const base = [styles.card, { backgroundColor: colors.surface }, tone === 'waiting' && { borderColor: colors.waitingEdge, backgroundColor: colors.surfaceTop }, style]
  if (!onPress) return <View style={base}>{children}</View>
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [base, pressed && { backgroundColor: colors.surfaceHover }]}>
      {children}
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, padding: space[7], borderWidth: StyleSheet.hairlineWidth * 2, borderColor: 'transparent', gap: space[4] }
})
