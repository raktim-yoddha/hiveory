import { useState, type ReactNode } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { SendHorizontal } from 'lucide-react-native'
import { font, radius, space, useTheme } from '@/core/theme'
import { IconButton } from '@/core/ui'

export interface ComposerProps {
  petName: string
  onSend: (text: string) => Promise<unknown>
  busy: boolean
  /** Controlled text, for a screen that also puts text in (a saved prompt); uncontrolled otherwise. */
  text?: string
  onText?: (text: string) => void
  /** Buttons before the box (attach, saved prompts). */
  tools?: ReactNode
  /** Sendable with no text (files are attached). */
  ready?: boolean
}

/** A message box for a chat-view agent: Send hands the text to `onSend`, which decides how it goes. */
export function Composer({ petName, onSend, busy, text: controlled, onText, tools, ready }: ComposerProps) {
  const { colors } = useTheme()
  const [own, setOwn] = useState('')
  const text = controlled ?? own
  const setText = (next: string | ((current: string) => string)): void => {
    const value = typeof next === 'function' ? next(text) : next
    if (onText) onText(value)
    else setOwn(value)
  }
  const send = (): void => {
    const message = text.trim()
    if ((!message && !ready) || busy) return
    // Cleared at once, so the message leaves the box the moment it is sent; it comes back if sending fails.
    setText('')
    onSend(message).catch(() => setText((current) => current || message))
  }
  return (
    <View style={[styles.row, { backgroundColor: colors.surfaceInset }]}>
      {tools}
      <TextInput
        accessibilityLabel={`Message ${petName}`}
        placeholder={`Message ${petName}`}
        placeholderTextColor={colors.textFaint}
        selectionColor={colors.accent}
        value={text}
        onChangeText={setText}
        // Enter starts a new line, as in a phone's chat apps; Send sends (a multi-line message reaches the
        // agent as one paste, so its lines don't submit one by one).
        multiline
        submitBehavior="newline"
        style={[styles.input, { color: colors.text }]}
      />
      <IconButton label="Send" icon={SendHorizontal} tone="accent" onPress={send} disabled={(!text.trim() && !ready) || busy} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', borderRadius: radius.lg, paddingLeft: space[6], marginHorizontal: space[5] },
  input: { flex: 1, minHeight: 44, maxHeight: 120, fontSize: font.size.body, paddingVertical: space[5] }
})
