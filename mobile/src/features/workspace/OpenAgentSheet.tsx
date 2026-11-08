import { router } from 'expo-router'
import { MessageSquare, Trash2 } from 'lucide-react-native'
import { useAction, useCall } from '@/core/api'
import { routes } from '@/core/routes'
import { useTheme } from '@/core/theme'
import { CliLogo, confirm, IconButton, ListRow, Section, Sheet, Text } from '@/core/ui'

/**
 * Open an agent here: the CLIs installed on the project's machine (from the
 * computer's registry, AGENTS.md rule 15), agents first, then plain shells. A CLI opens in its
 * terminal; Chat UI opens a chat whose CLI and model are picked in its message box (ADR 0059).
 */
export function OpenAgentSheet({ workspaceId, projectId, open, onClose }: { workspaceId: string; projectId: string; open: boolean; onClose: () => void }) {
  const clis = useCall('clis.list', { projectId }, { enabled: open })
  const presets = useCall('presets.list', undefined, { enabled: open })
  const project = useCall('projects.list', undefined).data?.find((p) => p.id === projectId)
  const chatClis = useCall('chat.clis', undefined, { enabled: open })
  const openAgent = useAction('agents.open')
  const applyPreset = useAction('agents.applyPreset')
  const deletePreset = useAction('presets.delete')
  const { colors } = useTheme()
  const available = (clis.data ?? []).filter((c) => c.available)
  // Chat UI runs its CLI headless on the computer itself, so SSH Workspaces only get terminals.
  const chatCli = project?.host ? undefined : chatClis.data?.[0]

  const start = (cliId: string, chatUi = false): void =>
    openAgent.mutate(
      { workspaceId, cliId, chatUi },
      {
        onSuccess: ({ agent }) => {
          onClose()
          router.push(routes.agent(agent.id, workspaceId, projectId))
        }
      }
    )

  return (
    <Sheet open={open} title="Open an agent" onClose={onClose}>
      {chatCli ? (
        <Section title="Chat">
          <ListRow
            title="Chat UI"
            subtitle="Pick and change the CLI and model in the chat"
            leading={<MessageSquare size={18} color={colors.textMuted} />}
            onPress={openAgent.isPending ? undefined : () => start(chatCli, true)}
          />
        </Section>
      ) : null}
      {clis.isLoading ? <Text tone="muted">Looking at what is installed…</Text> : null}
      {!clis.isLoading && !available.length ? <Text tone="muted">No CLI is installed on that machine yet.</Text> : null}
      {(['agent', 'shell'] as const).map((kind) =>
        available.some((c) => c.kind === kind) ? (
          <Section key={kind} title={kind === 'agent' ? 'Agents' : 'Terminals'}>
            {available
              .filter((c) => c.kind === kind)
              .map((c) => (
                <ListRow
                  key={c.id}
                  title={c.displayName}
                  leading={<CliLogo icon={c.icon} />}
                  onPress={openAgent.isPending ? undefined : () => start(c.id)}
                />
              ))}
          </Section>
        ) : null
      )}
      {presets.data?.length ? (
        <Section title="Presets">
          {presets.data.map((p) => (
            <ListRow
              key={p.id}
              title={p.name}
              subtitle={[p.cliSelections.map((s) => `${s.count}× ${s.cliId}`).join(', ')].join(' · ')}
              action={<IconButton label={`Delete preset ${p.name}`} icon={Trash2} onPress={() => confirm(`Delete ${p.name}?`, 'Agents it opened keep running.', 'Delete', () => deletePreset.mutate({ presetId: p.id }))} />}
              onPress={() => applyPreset.mutate({ workspaceId, presetId: p.id }, { onSuccess: onClose })}
            />
          ))}
        </Section>
      ) : null}
    </Sheet>
  )
}
