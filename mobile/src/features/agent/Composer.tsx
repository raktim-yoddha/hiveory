import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { SendHorizontal } from 'lucide-react-native'
import { font, radius, space, useTheme } from '@/core/theme'
import { IconButton } from '@/core/ui'

/** Writes to the agent like typing in its prompt and pressing Enter (agents.sendMessage), on Send. */
export function Composer({ petName, onSend, busy }: { petName: string; onSend: (text: string) => Promise<unknown>; busy: boolean }) {
  const { colors } = useTheme()
  const [text, setText] = useState('')
  const send = (): void => {
    const message = text.trim()
    if (!message || busy) return
    // Cleared at once, so the message leaves the box the moment it is sent; it comes back if sending fails.
    setText('')
    onSend(message).catch(() => setText((current) => current || message))
  }
  return (
    <View style={[styles.row, { backgroundColor: colors.surfaceInset }]}>
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
      <IconButton label="Send" icon={SendHorizontal} tone="accent" onPress={send} disabled={!text.trim() || busy} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', borderRadius: radius.lg, paddingLeft: space[6], marginHorizontal: space[5] },
  input: { flex: 1, minHeight: 44, maxHeight: 120, fontSize: font.size.body, paddingVertical: space[5] }
})
