import { useRef, useState } from 'react'
import { KeyboardAvoidingView, Platform, StyleSheet, View } from 'react-native'
import { Stack } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ellipsis, SearchX } from 'lucide-react-native'
import { useAction, useCall, useCliIcons } from '@/core/api'
import { KEYS, TerminalView, type TerminalHandle } from '@/core/terminal'
import { space, useTheme } from '@/core/theme'
import { agentLine, Button, CliLogo, EmptyState, IconButton, Loading, Screen, StatusPill, Text } from '@/core/ui'
import { AgentActions } from './AgentActions'
import { ChatThread } from './ChatThread'
import { Composer } from './Composer'
import { KeyBar } from './KeyBar'
import { ModelBar } from './ModelBar'

/**
 * One agent, live (ADR 0027): its terminal (or chat) exactly as on the computer, a bar to
 * answer it when it needs the user, the keys a phone lacks, and a message box.
 */
export function AgentScreen({ instanceId, workspaceId }: { instanceId: string; workspaceId: string }) {
  const { colors } = useTheme()
  const insets = useSafeAreaInsets()
  const headerHeight = useHeaderHeight()
  const agents = useCall('agents.list', { workspaceId })
  const agent = agents.data?.find((a) => a.id === instanceId)
  const icons = useCliIcons(agent?.projectId)
  const write = useAction('terminal.write', { quiet: true })
  const message = useAction('agents.sendMessage')
  const terminal = useRef<TerminalHandle>(null)
  const [actions, setActions] = useState(false)

  if (agents.isLoading) return <Loading />
  if (!agent) {
    return (
      <Screen>
        <EmptyState icon={SearchX} title="This agent is closed" body="It was closed on the computer, or its worktree was removed." />
      </Screen>
    )
  }

  const key = (bytes: string): void => write.mutate({ instanceId, data: bytes })
  const waiting = agent.runtime.status === 'waiting-for-you'

  return (
    <>
      <Stack.Screen
        options={{
          title: agent.petName,
          // Which CLI this is, before its name, as in the computer's pane header.
          headerTitle: () => (
            <View style={styles.title}>
              <CliLogo icon={icons.get(agent.cliId)} size={22} />
              <Text variant="lead" numberOfLines={1}>
                {agent.petName}
              </Text>
            </View>
          ),
          headerRight: () => (
            <View style={styles.headerRight}>
              <StatusPill status={agent.runtime.status} />
              <IconButton label={`Actions for ${agent.petName}`} icon={Ellipsis} onPress={() => setActions(true)} />
            </View>
          )
        }}
      />
      <KeyboardAvoidingView style={[styles.fill, { backgroundColor: colors.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={headerHeight}>
        {agent.chatUi ? (
          <ChatThread instanceId={instanceId} petName={agent.petName} />
        ) : (
          <TerminalView ref={terminal} instanceId={instanceId} />
        )}
        <View style={[styles.dock, { backgroundColor: colors.surface, paddingBottom: Math.max(insets.bottom, space[4]) }]}>
          {waiting ? (
            <View style={[styles.waiting, { backgroundColor: colors.waitingSoft }]}>
              <Text variant="label" tone="waiting" style={styles.waitingText} numberOfLines={2}>
                {agentLine(agent.runtime)}
              </Text>
              <Button label="Esc" size="sm" onPress={() => key(KEYS.escape)} />
              <Button label="Enter ⏎" size="sm" variant="waiting" onPress={() => key(KEYS.enter)} />
            </View>
          ) : null}
          {/* A chat-view agent has no terminal to press keys into. */}
          {agent.chatUi ? <ModelBar chatId={instanceId} /> : <KeyBar onKey={key} />}
          <Composer petName={agent.petName} busy={message.isPending} onSend={(text) => message.mutateAsync({ instanceId, message: text })} />
        </View>
      </KeyboardAvoidingView>
      <AgentActions instanceId={instanceId} petName={agent.petName} open={actions} onClose={() => setActions(false)} onReload={() => terminal.current?.reload()} />
    </>
  )
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  title: { flexDirection: 'row', alignItems: 'center', gap: space[4], flexShrink: 1 },
  dock: { gap: space[4], paddingTop: space[4] },
  waiting: { flexDirection: 'row', alignItems: 'center', gap: space[4], marginHorizontal: space[5], padding: space[4], borderRadius: 12 },
  waitingText: { flex: 1 }
})
