import { useRef, useState } from 'react'
import { KeyboardAvoidingView, StyleSheet, View } from 'react-native'
import { Stack } from 'expo-router'
import { useHeaderHeight } from 'expo-router/react-navigation'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Ellipsis, SearchX } from 'lucide-react-native'
import { useAction, useCall, useCliIcons } from '@/core/api'
import { KEYS, TerminalView, withModifiers, type Modifiers, type TerminalHandle } from '@/core/terminal'
import { space, useTheme } from '@/core/theme'
import { agentLine, Button, CliLogo, EmptyState, IconButton, Loading, Screen, StatusPill, Text } from '@/core/ui'
import { AgentActions } from './AgentActions'
import { ChatThread, Composer, ModelBar } from '@/core/chat'
import { KeyBar } from './KeyBar'
import { TerminalInput } from './TerminalInput'

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
  // Bumped each time the key bar's Enter sends the prompt, so the typing box starts fresh.
  const [line, setLine] = useState(0)
  // Ctrl and Alt from the key bar, held for the next key (typed or tapped).
  const [modifiers, setModifiers] = useState<Modifiers>({ ctrl: false, alt: false })

  if (agents.isLoading) return <Loading />
  if (!agent) {
    return (
      <Screen>
        <EmptyState icon={SearchX} title="This agent is closed" body="It was closed on the computer, or its worktree was removed." />
      </Screen>
    )
  }

  const key = (bytes: string): void => write.mutate({ instanceId, data: bytes })
  /** A key or typed text, with a held Ctrl or Alt applied once. */
  const press = (bytes: string): void => {
    if (!modifiers.ctrl && !modifiers.alt) return key(bytes)
    key(withModifiers(bytes, modifiers))
    setModifiers({ ctrl: false, alt: false })
    // The box no longer mirrors the prompt after a combination (Ctrl+C clears it): start it fresh.
    setLine((n) => n + 1)
  }
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
      {/* Padding on Android too: edge to edge, the window no longer shrinks for the keyboard, so the keys would sit under it (ADR 0048). */}
      <KeyboardAvoidingView style={[styles.fill, { backgroundColor: colors.bg }]} behavior="padding" keyboardVerticalOffset={headerHeight}>
        {agent.chatUi ? (
          <ChatThread chatId={instanceId} title={`Chat with ${agent.petName}`} />
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
          {/* A chat-view agent gets a message box; a terminal is typed into directly, keys right above the keyboard (ADR 0039). */}
          {agent.chatUi ? (
            <>
              <ModelBar chatId={instanceId} />
              <Composer petName={agent.petName} busy={message.isPending} onSend={(text) => message.mutateAsync({ instanceId, message: text })} />
            </>
          ) : (
            <>
              {/* Keyed by the sent line: after the key bar's Enter the box starts fresh. */}
              <TerminalInput key={line} petName={agent.petName} onType={press} />
              <KeyBar
                onKey={press}
                modifiers={modifiers}
                onModifiers={setModifiers}
                onEnter={() => {
                  key(KEYS.enter)
                  setLine((n) => n + 1)
                }}
              />
            </>
          )}
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
