import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { SendHorizontal } from 'lucide-react-native'
import { font, radius, space, useTheme } from '@/core/theme'
import { IconButton } from '@/core/ui'

/** Writes to the agent like typing in its prompt and pressing Enter (agents.sendMessage). */
export function Composer({ petName, onSend, busy }: { petName: string; onSend: (text: string) => Promise<unknown>; busy: boolean }) {
  const { colors } = useTheme()
  const [text, setText] = useState('')
  const send = (): void => {
    const message = text.trim()
    if (!message || busy) return
    void onSend(message).then(() => setText(''))
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
        multiline
        style={[styles.input, { color: colors.text }]}
        submitBehavior="blurAndSubmit"
        returnKeyType="send"
        onSubmitEditing={send}
      />
      <IconButton label="Send" icon={SendHorizontal} tone="accent" onPress={send} disabled={!text.trim() || busy} />
    </View>
  )
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', borderRadius: radius.lg, paddingLeft: space[6], marginHorizontal: space[5] },
  input: { flex: 1, minHeight: 44, maxHeight: 120, fontSize: font.size.body, paddingVertical: space[5] }
})
