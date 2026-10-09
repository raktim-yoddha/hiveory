import { useState } from 'react'
import { router } from 'expo-router'
import { opensAsChat } from '@shared/domain/project'
import { useAction, useCall } from '@/core/api'
import { routes } from '@/core/routes'
import { CliLogo, ListRow, Section, Segmented, Sheet, Text } from '@/core/ui'

/**
 * Open an agent here: the CLIs installed on the project's machine (from the
 * computer's registry, AGENTS.md rule 15), agents first, then plain shells.
 * Agents open as a chat or a terminal, starting from the Workspace's setting (ADR 0037).
 */
export function OpenAgentSheet({ workspaceId, projectId, open, onClose }: { workspaceId: string; projectId: string; open: boolean; onClose: () => void }) {
  const clis = useCall('clis.list', { projectId }, { enabled: open })
  const presets = useCall('presets.list', undefined, { enabled: open })
  const project = useCall('projects.list', undefined).data?.find((p) => p.id === projectId)
  const worktree = useCall('workspaces.list', { projectId }).data?.find((w) => w.id === workspaceId)
  const chatClis = useCall('chat.clis', undefined, { enabled: open })
  const openAgent = useAction('agents.open')
  const applyPreset = useAction('agents.applyPreset')
  const [picked, setPicked] = useState<'chat' | 'terminal' | null>(null)
  const available = (clis.data ?? []).filter((c) => c.available)
  // Chat view runs the CLI headless on the computer itself, so SSH Workspaces only get terminals.
  const chatPossible = !project?.host
  const view = chatPossible ? (picked ?? (opensAsChat(project, worktree) ? 'chat' : 'terminal')) : 'terminal'

  const start = (cliId: string, kind: 'agent' | 'shell'): void =>
    openAgent.mutate(
      { workspaceId, cliId, chatUi: kind === 'agent' && view === 'chat' },
      {
        onSuccess: ({ agent }) => {
          onClose()
          router.push(routes.agent(agent.id, workspaceId, projectId))
        }
      }
    )

  return (
    <Sheet open={open} title="Open an agent" onClose={onClose}>
      {chatPossible ? (
        <Segmented
          label="Open agents as"
          value={view}
          onChange={setPicked}
          options={[
            { value: 'terminal', label: 'Terminal' },
            { value: 'chat', label: 'Chat' }
          ]}
        />
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
                  subtitle={kind === 'agent' && view === 'chat' && chatClis.data && !chatClis.data.includes(c.id) ? 'Terminal only' : undefined}
                  leading={<CliLogo icon={c.icon} />}
                  onPress={openAgent.isPending ? undefined : () => start(c.id, kind)}
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
              subtitle={[p.cliSelections.map((s) => `${s.count}× ${s.cliId}`).join(', '), p.chatUi ? 'chat' : null].filter(Boolean).join(' · ')}
              onPress={() => applyPreset.mutate({ workspaceId, presetId: p.id }, { onSuccess: onClose })}
            />
          ))}
        </Section>
      ) : null}
    </Sheet>
  )
}
