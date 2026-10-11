import { useEffect } from 'react'
import type { CliDescriptor } from '@shared/domain'
import { CliLogo } from '../../components/cli/CliLogo'
import type { MenuEntry } from '../../components/ui/Menu'
import { useHostClis } from '../../stores/data'
import { selectedProjectId, useNavigation } from '../../stores/navigation'

/**
 * Menu entries for every detected CLI — the agent list is never hardcoded (AGENTS.md rule 15) —
 * grouped as Terminals then Agents, as everywhere a pane can be opened (ADR 0039).
 */
export const useAgentMenuEntries = (onPick: (cliId: string) => void): MenuEntry[] => {
  const projectId = useNavigation((s) => selectedProjectId(s.view))
  const { clis, loaded, load } = useHostClis(projectId)
  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])
  const available = clis.filter((c) => c.available)
  const item = (cli: CliDescriptor): MenuEntry => ({
    type: 'item',
    id: `cli-${cli.id}`,
    label: cli.displayName,
    icon: <CliLogo cliId={cli.id} size="sm" />,
    onSelect: () => onPick(cli.id)
  })
  const shells = available.filter((c) => c.kind === 'shell')
  const agents = available.filter((c) => c.kind !== 'shell')
  return [
    ...(shells.length ? [{ type: 'label' as const, label: 'Terminals' }, ...shells.map(item)] : []),
    ...(agents.length ? [{ type: 'label' as const, label: 'Agents' }, ...agents.map(item)] : [])
  ]
}
