import { useRef } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import { MessageSquareText } from 'lucide-react-native'
import type { ChatMessage } from '@shared/domain/chat'
import { useCall, useConnection, useServerEvent, type Response } from '@/core/api'
import { pageX, radius, space, useTheme } from '@/core/theme'
import { EmptyState, Loading, Text } from '@/core/ui'

/**
 * A chat-view agent's conversation, live: the chat behind the agent shares its id. The question
 * shows as soon as it is sent, and the reply streams in as the computer reports it (chat.event).
 */
export function ChatThread({ instanceId, petName }: { instanceId: string; petName: string }) {
  const { computer } = useConnection()
  const queryClient = useQueryClient()
  const payload = { chatId: instanceId }
  const chat = useCall('chat.get', payload)
  const scroll = useRef<ScrollView>(null)

  useServerEvent('chat.event', ({ chatId, message, summary }) => {
    if (chatId !== instanceId) return
    queryClient.setQueryData<Response<'chat.get'>>([computer?.id, 'chat.get', payload], (current) => {
      if (!current) return current
      const index = current.messages.findIndex((m) => m.id === message.id)
      const messages = index >= 0 ? current.messages.map((m, i) => (i === index ? message : m)) : [...current.messages, message]
      return { ...current, messages, running: summary.running }
    })
  })

  if (chat.isLoading) return <Loading />
  const messages = chat.data?.messages ?? []
  if (!messages.length) return <EmptyState icon={MessageSquareText} title={`Chat with ${petName}`} body="Send a message below; the answer shows here and on the computer." />

  return (
    <ScrollView
      ref={scroll}
      contentContainerStyle={styles.list}
      onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: true })}
      keyboardShouldPersistTaps="handled"
    >
      {messages.map((m) => (
        <Message key={m.id} message={m} />
      ))}
    </ScrollView>
  )
}

function Message({ message }: { message: ChatMessage }) {
  const { colors } = useTheme()
  if (message.role === 'user') {
    const text = message.parts.map((p) => (p.kind === 'text' ? p.text : '')).join('\n')
    return (
      <View style={[styles.user, { backgroundColor: colors.surfaceRaised }]}>
        {message.attachments?.map((a) => (
          <Text key={a.path} variant="caption" tone="muted">
            {a.name}
          </Text>
        ))}
        {text ? <Text selectable>{text}</Text> : null}
      </View>
    )
  }
  return (
    <View style={styles.assistant}>
      {message.parts.map((part, i) =>
        part.kind === 'text' ? (
          <Text key={i} selectable>
            {part.text}
          </Text>
        ) : part.kind === 'tool' ? (
          <Text key={i} variant="caption" tone={part.status === 'error' ? 'danger' : 'muted'} numberOfLines={1}>
            {part.name}
            {part.detail ? ` · ${part.detail}` : ''}
          </Text>
        ) : null
      )}
      {message.streaming && !message.parts.some((p) => p.kind === 'text') ? (
        <View style={styles.working}>
          <ActivityIndicator size="small" color={colors.working} />
          <Text variant="caption" tone="working">
            Working…
          </Text>
        </View>
      ) : null}
      {message.error ? (
        <Text variant="caption" tone="danger" selectable>
          {message.error}
        </Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: space[7], paddingHorizontal: pageX, paddingVertical: space[7] },
  user: { alignSelf: 'flex-end', maxWidth: '85%', gap: space[2], paddingHorizontal: space[6], paddingVertical: space[5], borderRadius: radius.lg },
  assistant: { gap: space[4] },
  working: { flexDirection: 'row', alignItems: 'center', gap: space[3] }
})
