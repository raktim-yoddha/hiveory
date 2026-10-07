import { forwardRef } from 'react'
import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native'
import { font, radius, space, touch, useTheme } from '../theme'
import { Text } from './Text'

export interface TextFieldProps extends TextInputProps {
  label?: string
  hint?: string
  mono?: boolean
}

/** A labelled input, 44 points tall at least, themed like the desktop's inset fields. */
export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField({ label, hint, mono, style, ...rest }, ref) {
  const { colors } = useTheme()
  return (
    <View style={styles.wrap}>
      {label ? (
        <Text variant="label" tone="secondary">
          {label}
        </Text>
      ) : null}
      <TextInput
        ref={ref}
        accessibilityLabel={label}
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.accent}
        autoCorrect={false}
        style={[styles.input, { backgroundColor: colors.surfaceInset, color: colors.text, fontFamily: mono ? font.mono : undefined }, style]}
        {...rest}
      />
      {hint ? (
        <Text variant="caption" tone="muted">
          {hint}
        </Text>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  wrap: { gap: space[3] },
  input: { minHeight: touch, borderRadius: radius.md, paddingHorizontal: space[6], paddingVertical: space[4], fontSize: font.size.body }
})
