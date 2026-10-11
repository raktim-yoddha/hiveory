import { useRef, useState } from 'react'
import { StyleSheet, TextInput } from 'react-native'
import { font, radius, space, useTheme } from '@/core/theme'

/** Erases one character in a terminal (what Backspace sends). */
const BACKSPACE = '\x7f'
/** A new line inside the CLI's prompt without sending it (Ctrl+J), as the keyboard's own Enter. */
const NEWLINE = '\n'

/**
 * Types straight into the terminal (ADR 0039): every character goes to the CLI as it is typed, and
 * deleting erases there too, so the phone feels like the computer's prompt. The keyboard's Enter
 * starts a new line in the prompt; the Enter key above the keyboard sends it.
 */
export function TerminalInput({ petName, onType }: { petName: string; onType: (bytes: string) => void }) {
  const { colors } = useTheme()
  // What the box shows mirrors what was sent since it was last cleared, so edits can be diffed.
  const [text, setText] = useState('')
  const sent = useRef('')

  const change = (next: string): void => {
    const prev = sent.current
    let common = 0
    while (common < prev.length && common < next.length && prev[common] === next[common]) common++
    const erase = prev.length - common
    const typed = next.slice(common).replace(/\r?\n/g, NEWLINE)
    if (erase || typed) onType(BACKSPACE.repeat(erase) + typed)
    sent.current = next
    // A line sent from the key bar starts fresh; long input is trimmed to stay light.
    setText(next.length > 2000 ? '' : next)
    if (next.length > 2000) sent.current = ''
  }

  return (
    <TextInput
      accessibilityLabel={`Type to ${petName}`}
      placeholder={`Type to ${petName}…`}
      placeholderTextColor={colors.textFaint}
      selectionColor={colors.accent}
      value={text}
      onChangeText={change}
      onKeyPress={(e) => {
        // Backspace in an empty box still erases in the terminal.
        if (e.nativeEvent.key === 'Backspace' && !sent.current) onType(BACKSPACE)
      }}
      multiline
      autoCorrect={false}
      autoCapitalize="none"
      spellCheck={false}
      autoComplete="off"
      style={[styles.input, { color: colors.text, backgroundColor: colors.surfaceInset }]}
    />
  )
}

const styles = StyleSheet.create({
  input: { minHeight: 40, maxHeight: 96, marginHorizontal: space[5], paddingHorizontal: space[6], paddingVertical: space[4], borderRadius: radius.lg, fontSize: font.size.body }
})
