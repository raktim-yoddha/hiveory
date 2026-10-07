import { Pressable, StyleSheet, type PressableProps } from 'react-native'
import { radius, touch, useTheme } from '../theme'
import type { IconComponent } from './Button'

export interface IconButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  /** Required: an icon alone must still say what it does (AGENTS.md rule 20). */
  label: string
  icon: IconComponent
  tone?: 'default' | 'accent' | 'danger'
  filled?: boolean
}

export function IconButton({ label, icon: Icon, tone = 'default', filled, ...rest }: IconButtonProps) {
  const { colors } = useTheme()
  const color = tone === 'accent' ? colors.accent : tone === 'danger' ? colors.danger : colors.textSecondary
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
      style={({ pressed }) => [styles.base, { backgroundColor: pressed ? colors.surfaceActive : filled ? colors.surfaceRaised : 'transparent' }]}
      {...rest}
    >
      <Icon size={20} color={color} strokeWidth={2} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: { width: touch, height: touch, alignItems: 'center', justifyContent: 'center', borderRadius: radius.md }
})
