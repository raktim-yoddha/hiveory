import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'
import { Stack } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Square } from 'lucide-react-native'
import { useAction, useCall } from '@/core/api'
import { ChatThread, Composer, ModelBar } from '@/core/chat'
import { space, useTheme } from '@/core/theme'
import { IconButton, Loading } from '@/core/ui'

/** One chat or bot thread, live (ADR 0039): the conversation, its model and effort, and a message box. */
export function ChatScreen({ chatId }: { chatId: string }) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const headerHeight = useHeaderHeight()
  const chat = useCall('chat.get', { chatId })
  const send = useAction('chat.send')
  const stop = useAction('chat.stop')

  if (chat.isLoading || !chat.data) return <Loading />
  const title = chat.data.title

  return (
    <>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (chat.data?.running ? <IconButton label="Stop answering" icon={Square} onPress={() => stop.mutate({ chatId })} /> : null)
        }}
      />
      <KeyboardAvoidingView style={[styles.fill, { backgroundColor: colors.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={headerHeight}>
        <ChatThread chatId={chatId} title={title} />
        <View style={[styles.dock, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, space[4]) }]}>
          <ModelBar chatId={chatId} />
          <Composer petName={title} busy={send.isPending || Boolean(chat.data.running)} onSend={(text) => send.mutateAsync({ chatId, text })} />
        </View>
      </KeyboardAvoidingView>
    </>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  dock: { gap: space[4], paddingTop: space[4] }
})
