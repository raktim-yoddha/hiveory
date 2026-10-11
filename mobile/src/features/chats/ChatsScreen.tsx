import { useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { router, Stack } from 'expo-router'
import { MessagesSquare, Plus } from 'lucide-react-native'
import { useAction, useCall, useCliIcons } from '@/core/api'
import { routes } from '@/core/routes'
import { space } from '@/core/theme'
import { Button, CliLogo, EmptyState, IconButton, ListRow, Loading, Logo, Screen, Section, Sheet, StatusDot } from '@/core/ui'

/** Chat mode on the phone (ADR 0039): every chat, newest first; tap to continue it, + to start one on a CLI. */
export function ChatsScreen() {
  const chats = useCall('chat.list', undefined)
  const icons = useCliIcons()
  const [picking, setPicking] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  // Chat mode lists plain chats; agents' and bots' chats live in their own places.
  const list = (chats.data ?? []).filter((c) => !c.agentId && !c.botId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))

  return (
    <>
      <Stack.Screen options={{ headerRight: () => <IconButton label="New chat" icon={Plus} onPress={() => setPicking(true)} /> }} />
      {chats.isLoading ? (
        <Loading label="Loading chats…" />
      ) : !list.length ? (
        <EmptyState media={<Logo size={52} />} title="Chat with any agent" body="Pick a CLI and just talk. Chats keep running on the computer." action={<Button label="New chat" icon={Plus} variant="primary" onPress={() => setPicking(true)} />} />
      ) : (
        <Screen
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true)
            void chats.refetch().finally(() => setRefreshing(false))
          }}
        >
          <Section>
            {list.map((c) => (
              <ListRow
                key={c.id}
                title={c.title}
                subtitle={new Date(c.updatedAt).toLocaleString()}
                leading={c.cliId ? <CliLogo icon={icons.get(c.cliId)} size={24} /> : <MessagesSquare size={20} />}
                trailing={c.running ? <StatusDot status="working" /> : null}
                onPress={() => router.push(routes.chat(c.id))}
              />
            ))}
          </Section>
        </Screen>
      )}
      <NewChatSheet open={picking} onClose={() => setPicking(false)} />
    </>
  )
}

/** Starts a chat on the chosen CLI and opens it. */
function NewChatSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const clis = useCall('chat.clis', undefined, { enabled: open })
  const icons = useCliIcons()
  const names = useCall('clis.list', undefined, { staleTime: 10 * 60_000 })
  const create = useAction('chat.create')
  const start = (cliId: string): void => {
    create.mutate(
      { cliId },
      {
        onSuccess: (chat) => {
          onClose()
          router.push(routes.chat(chat.id))
        }
      }
    )
  }
  return (
    <Sheet open={open} title="New chat" onClose={onClose}>
      <View style={styles.list}>
        {(clis.data ?? []).map((id) => (
          <ListRow key={id} title={names.data?.find((c) => c.id === id)?.displayName ?? id} leading={<CliLogo icon={icons.get(id)} size={24} />} onPress={() => start(id)} />
        ))}
        {clis.isLoading ? <Loading /> : null}
      </View>
    </Sheet>
  )
}

const styles = StyleSheet.create({ list: { gap: space[2] } })
