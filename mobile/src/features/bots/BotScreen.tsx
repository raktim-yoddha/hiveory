import { useState } from 'react'
import { router, Stack } from 'expo-router'
import { MessageSquarePlus, MessagesSquare } from 'lucide-react-native'
import { useAction, useCall } from '@/core/api'
import { routes } from '@/core/routes'
import { Button, EmptyState, IconButton, ListRow, Loading, Screen, Section, StatusDot } from '@/core/ui'

/** One bot's threads, newest first (ADR 0039); open one to continue it, or start a new one. */
export function BotScreen({ botId }: { botId: string }) {
  const bots = useCall('bots.list', undefined)
  const threads = useCall('bots.threads', { botId })
  const start = useAction('bots.newThread')
  const [refreshing, setRefreshing] = useState(false)
  const bot = bots.data?.find((b) => b.id === botId)
  const newThread = (): void => start.mutate({ botId }, { onSuccess: (chat) => router.push(routes.chat(chat.id)) })
  const list = [...(threads.data ?? [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  return (
    <>
      <Stack.Screen options={{ title: bot?.name ?? 'Bot', headerRight: () => <IconButton label="New thread" icon={MessageSquarePlus} onPress={newThread} /> }} />
      {threads.isLoading ? (
        <Loading />
      ) : !list.length ? (
        <EmptyState icon={MessagesSquare} title={`Talk to ${bot?.name ?? 'this bot'}`} body="Start a thread; it runs on the computer and you can follow it here." action={<Button label="New thread" icon={MessageSquarePlus} variant="primary" loading={start.isPending} onPress={newThread} />} />
      ) : (
        <Screen
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true)
            void threads.refetch().finally(() => setRefreshing(false))
          }}
        >
          <Section>
            {list.map((t) => (
              <ListRow key={t.id} title={t.title} subtitle={new Date(t.updatedAt).toLocaleString()} trailing={t.running ? <StatusDot status="working" /> : null} onPress={() => router.push(routes.chat(t.id))} />
            ))}
          </Section>
        </Screen>
      )}
    </>
  )
}
