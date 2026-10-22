import { useState } from 'react'
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native'
import { router, Stack } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Bookmark, MoreVertical, Paperclip, Square, X } from 'lucide-react-native'
import { useAction, useCall } from '@/core/api'
import { ChatThread, Composer, ModelBar } from '@/core/chat'
import { radius, space, useTheme } from '@/core/theme'
import { choose, confirm, IconButton, Loading, PromptSheet, Text } from '@/core/ui'
import { PromptsSheet } from './PromptsSheet'
import { useAttachments } from './useAttachments'

/**
 * One chat or bot thread, live (ADR 0039): the conversation, its model and effort, and a message box.
 * As on the computer (ADR 0053): files go with a message, a message typed while it answers waits its
 * turn (and can be taken back), saved prompts fill the box, and the chat can be renamed or deleted.
 */
export function ChatScreen({ chatId }: { chatId: string }) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const headerHeight = useHeaderHeight()
  const chat = useCall('chat.get', { chatId })
  const send = useAction('chat.send')
  const queue = useAction('chat.queue')
  const unqueue = useAction('chat.unqueue')
  const stop = useAction('chat.stop')
  const update = useAction('chat.update')
  const remove = useAction('chat.delete')
  const files = useAttachments(chatId)
  const [text, setText] = useState('')
  const [prompts, setPrompts] = useState(false)
  const [renaming, setRenaming] = useState(false)

  if (chat.isLoading || !chat.data) return <Loading />
  const title = chat.data.title
  const running = Boolean(chat.data.running)
  const queued = chat.data.queued ?? []

  const submit = async (message: string): Promise<void> => {
    // Files go with a new turn; a plain message waits its turn while the chat answers (chat.queue sends it at once otherwise).
    if (files.files.length) {
      await send.mutateAsync({ chatId, text: message, attachments: files.files })
      files.clear()
    } else await queue.mutateAsync({ chatId, text: message })
  }
  const menu = (): void =>
    choose(title, [
      { label: 'Rename', onPress: () => setRenaming(true) },
      { label: 'Delete chat', destructive: true, onPress: () => confirm(`Delete ${title}?`, 'Its messages are gone for good.', 'Delete', () => remove.mutate({ chatId }, { onSuccess: () => router.back() })) }
    ])

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <View style={styles.header}>
              {running ? <IconButton label="Stop answering" icon={Square} onPress={() => stop.mutate({ chatId })} /> : null}
              <IconButton label="Chat actions" icon={MoreVertical} onPress={menu} />
            </View>
          )
        }}
      />
      <KeyboardAvoidingView style={[styles.fill, { backgroundColor: colors.bg }]} behavior="padding" keyboardVerticalOffset={headerHeight}>
        <ChatThread chatId={chatId} title={title} />
        <View style={[styles.dock, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, space[4]) }]}>
          {queued.length || files.files.length ? (
            <ScrollView horizontal contentContainerStyle={styles.chips} keyboardShouldPersistTaps="handled">
              {queued.map((q, index) => (
                <View key={`q${index}`} style={[styles.chip, { backgroundColor: colors.surfaceRaised }]}>
                  <Text variant="caption" tone="secondary" numberOfLines={1} style={styles.chipText}>
                    Next: {q}
                  </Text>
                  <IconButton label="Take this message back" icon={X} onPress={() => unqueue.mutate({ chatId, index })} />
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
          <ModelBar chatId={chatId} />
          <Composer
            petName={title}
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
        </View>
      </KeyboardAvoidingView>
      <PromptsSheet open={prompts} draft={text} onPick={(p) => setText((now) => (now ? `${now}\n${p}` : p))} onClose={() => setPrompts(false)} />
      <PromptSheet
        open={renaming}
        title="Rename chat"
        label="Name"
        initial={title}
        action="Rename"
        maxLength={200}
        busy={update.isPending}
        onSubmit={(name) => update.mutate({ chatId, title: name }, { onSuccess: () => setRenaming(false) })}
        onClose={() => setRenaming(false)}
      />
    </>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dock: { gap: space[4], paddingTop: space[4] },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  chips: { gap: space[3], paddingHorizontal: space[5] },
  chip: { flexDirection: 'row', alignItems: 'center', gap: space[2], borderRadius: radius.md, paddingLeft: space[4], maxWidth: 260 },
  chipText: { flexShrink: 1 }
})
