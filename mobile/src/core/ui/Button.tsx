import type { ComponentType } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, View, type PressableProps } from 'react-native'
import { radius, space, touch, useTheme, type Palette } from '../theme'
import { Text } from './Text'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'waiting'
export type IconComponent = ComponentType<{ size?: number; color?: string; strokeWidth?: number }>

const look = (c: Palette, variant: Variant) =>
  ({
    primary: { bg: c.accent, fg: c.accentContrast, pressed: c.focus },
    secondary: { bg: c.surfaceRaised, fg: c.text, pressed: c.surfaceActive },
    ghost: { bg: 'transparent', fg: c.textSecondary, pressed: c.surfaceHover },
    danger: { bg: c.dangerSoft, fg: c.danger, pressed: c.surfaceActive },
    waiting: { bg: c.waitingSoft, fg: c.waiting, pressed: c.surfaceActive }
  })[variant]

export interface ButtonProps extends Omit<PressableProps, 'children' | 'style'> {
  label: string
  variant?: Variant
  size?: 'md' | 'sm'
  icon?: IconComponent
  loading?: boolean
  /** Stretch to the row's width. */
  block?: boolean
}

/** A labelled action. Full touch height (44) by default; small ones still have a 44 hit area. */
export function Button({ label, variant = 'secondary', size = 'md', icon: Icon, loading, disabled, block, ...rest }: ButtonProps) {
  const { colors } = useTheme()
  const l = look(colors, variant)
  const height = size === 'md' ? touch : 34
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: Boolean(disabled || loading), busy: Boolean(loading) }}
      disabled={disabled || loading}
      hitSlop={size === 'sm' ? 5 : 0}
      style={({ pressed }) => [
        styles.base,
        { height, backgroundColor: pressed ? l.pressed : l.bg, opacity: disabled ? 0.45 : 1, paddingHorizontal: size === 'md' ? space[8] : space[6] },
        block && styles.block
      ]}
      {...rest}
    >
      <View style={styles.row}>
        {loading ? <ActivityIndicator size="small" color={l.fg} /> : Icon ? <Icon size={size === 'md' ? 18 : 16} color={l.fg} strokeWidth={2} /> : null}
        <Text variant="label" style={{ color: l.fg, fontSize: size === 'md' ? 15 : 13 }} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  base: { alignItems: 'center', justifyContent: 'center', borderRadius: radius.md },
  block: { alignSelf: 'stretch' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[4] }
})
