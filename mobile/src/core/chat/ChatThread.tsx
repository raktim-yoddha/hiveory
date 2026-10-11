import { useRef } from 'react'
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native'
import { useQueryClient } from '@tanstack/react-query'
import type { ChatMessage } from '@shared/domain/chat'
import { useCall, useCliIcons, useConnection, useServerEvent, type Response } from '@/core/api'
import { pageX, radius, space, useTheme } from '@/core/theme'
import { CliLogo, EmptyState, Loading, Logo, Markdown, Text } from '@/core/ui'

/**
 * A conversation, live: a chat, a bot's thread, or a chat-view agent (whose chat shares its id). The
 * question shows as soon as it is sent, and the reply streams in as the computer reports it
 * (chat.event). Empty, it shows the chat's CLI logo, or Hiveory's before one is chosen (ADR 0039).
 */
export function ChatThread({ chatId: instanceId, title }: { chatId: string; title: string }) {
  const { computer } = useConnection()
  const queryClient = useQueryClient()
  const icons = useCliIcons()
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

  const messages = chat.data?.messages ?? []
  // Loading and empty fill the screen too, so the message box stays at the bottom.
  if (chat.isLoading || !messages.length) {
    return (
      <View style={styles.fill}>
        {chat.isLoading ? (
          <Loading />
        ) : (
          <EmptyState
            media={chat.data?.cliId ? <CliLogo icon={icons.get(chat.data.cliId)} size={52} /> : <Logo size={52} />}
            title={title}
            body="Send a message below; the answer shows here and on the computer."
          />
        )}
      </View>
    )
  }

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
          <Markdown key={i} text={part.text} />
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
  fill: { flex: 1, justifyContent: 'center' },
  list: { gap: space[7], paddingHorizontal: pageX, paddingVertical: space[7] },
  user: { alignSelf: 'flex-end', maxWidth: '85%', gap: space[2], paddingHorizontal: space[6], paddingVertical: space[5], borderRadius: radius.lg },
  assistant: { gap: space[4] },
  working: { flexDirection: 'row', alignItems: 'center', gap: space[3] }
})
