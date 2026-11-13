import { useState } from 'react'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Bookmark, Paperclip, X } from 'lucide-react-native'
import { useAction, useCall } from '@/core/api'
import { Composer, ModelBar, PromptCard } from '@/core/chat'
import { radius, space, useTheme } from '@/core/theme'
import { IconButton, Text } from '@/core/ui'
import { PromptsSheet } from './PromptsSheet'
import { useAttachments } from './useAttachments'

/**
 * A chat-view agent's message box, as on the computer (ADR 0053, 0056): its model and effort, files
 * that go with a message, a message typed while it answers waits its turn (and can be taken back),
 * and saved prompts fill the box. The agent's chat shares its id.
 */
export function ChatDock({ instanceId, petName }: { instanceId: string; petName: string }) {
  const { colors } = useTheme()
  const chat = useCall('chat.get', { chatId: instanceId })
  const send = useAction('chat.send')
  const queue = useAction('chat.queue')
  const unqueue = useAction('chat.unqueue')
  const files = useAttachments(instanceId)
  const [text, setText] = useState('')
  const [prompts, setPrompts] = useState(false)
  const running = Boolean(chat.data?.running)
  const queued = chat.data?.queued ?? []

  const submit = async (message: string): Promise<void> => {
    // Files go with a new turn; a plain message waits its turn while the agent answers (chat.queue sends it at once otherwise).
    if (files.files.length) {
      await send.mutateAsync({ chatId: instanceId, text: message, attachments: files.files })
      files.clear()
    } else await queue.mutateAsync({ chatId: instanceId, text: message })
  }

  return (
    <>
      <PromptCard chatId={instanceId} />
      {queued.length || files.files.length ? (
        <ScrollView horizontal contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
          {queued.map((q, index) => (
            <View key={`q${index}`} style={[styles.chip, { backgroundColor: colors.surfaceRaised }]}>
              <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.chipText}>
                Next: {q}
              </Text>
              <IconButton label="Take this message back" icon={X} onPress={() => unqueue.mutate({ chatId: instanceId, index })} />
            </View>
          ))}
          {files.files.map((f) => (
            <View key={f.path} style={[styles.chip, { backgroundColor: colors.surfaceRaised }]}>
              <Paperclip size={14} color={colors.textMuted} />
              <Text variant="caption" numberOfLines={1} style={styles.chipText}>
                {f.name}
              </Text>
              <IconButton label={`Remove ${f.name}`} icon={X} onPress={() => files.remove(f.path)} />
            </View>
          ))}
        </ScrollView>
      ) : null}
      <ModelBar chatId={instanceId} />
      <Composer
        petName={petName}
        text={text}
        onText={setText}
        ready={files.files.length > 0}
        // A message with files waits for the answer to end; a plain one can be lined up meanwhile.
        busy={send.isPending || queue.isPending || files.busy || (running && files.files.length > 0)}
        onSend={submit}
        tools={
          <>
            <IconButton label="Attach a file" icon={Paperclip} onPress={() => void files.pick()} disabled={files.busy} />
            <IconButton label="Saved prompts" icon={Bookmark} onPress={() => setPrompts(true)} />
          </>
        }
      />
      <PromptsSheet open={prompts} draft={text} onPick={(p) => setText((now) => (now ? `${now}\n${p}` : p))} onClose={() => setPrompts(false)} />
    </>
  )
}

const styles = StyleSheet.create({
  chips: { gap: space[3], paddingHorizontal: space[5] },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderRadius: radius.md, paddingLeft: space[4], maxWidth: 260 },
  chipText: { flexShrink: 1 }
})
