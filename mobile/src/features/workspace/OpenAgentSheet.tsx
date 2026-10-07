import { router } from 'expo-router'
import { useAction, useCall } from '@/core/api'
import { routes } from '@/core/routes'
import { CliLogo, ListRow, Section, Sheet, Text } from '@/core/ui'

/**
 * Open an agent here: the CLIs installed on the project's machine (from the
 * computer's registry, AGENTS.md rule 15), agents first, then plain shells.
 */
export function OpenAgentSheet({ workspaceId, projectId, open, onClose }: { workspaceId: string; projectId: string; open: boolean; onClose: () => void }) {
  const clis = useCall('clis.list', { projectId }, { enabled: open })
  const presets = useCall('presets.list', undefined, { enabled: open })
  const openAgent = useAction('agents.open')
  const applyPreset = useAction('agents.applyPreset')
  const available = (clis.data ?? []).filter((c) => c.available)

  const start = (cliId: string): void =>
    openAgent.mutate(
      { workspaceId, cliId },
      {
        onSuccess: ({ agent }) => {
          onClose()
          router.push(routes.agent(agent.id, workspaceId, projectId))
        }
      }
    )

  return (
    <Sheet open={open} title="Open an agent" onClose={onClose}>
      {clis.isLoading ? <Text tone="muted">Looking at what is installed…</Text> : null}
      {!clis.isLoading && !available.length ? <Text tone="muted">No CLI is installed on that machine yet.</Text> : null}
      {(['agent', 'shell'] as const).map((kind) =>
        available.some((c) => c.kind === kind) ? (
          <Section key={kind} title={kind === 'agent' ? 'Agents' : 'Terminals'}>
            {available
              .filter((c) => c.kind === kind)
              .map((c) => (
                <ListRow key={c.id} title={c.displayName} leading={<CliLogo icon={c.icon} />} onPress={openAgent.isPending ? undefined : () => start(c.id)} />
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
              subtitle={p.cliSelections.map((s) => `${s.count}× ${s.cliId}`).join(', ')}
              onPress={() => applyPreset.mutate({ workspaceId, presetId: p.id }, { onSuccess: onClose })}
            />
          ))}
        </Section>
      ) : null}
    </Sheet>
  )
}
