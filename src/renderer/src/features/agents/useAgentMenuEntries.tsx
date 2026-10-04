import { useEffect } from 'react'
import { CliLogo } from '../../components/cli/CliLogo'
import type { MenuEntry } from '../../components/ui/Menu'
import { useClis } from '../../stores/data'

/** Menu entries for every detected CLI — the agent list is never hardcoded (AGENTS.md rule 15). */
export const useAgentMenuEntries = (onPick: (cliId: string) => void): MenuEntry[] => {
  const { clis, loaded, load } = useClis()
  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])
  return clis
    .filter((c) => c.available)
    .map((cli) => ({
      type: 'item' as const,
      id: `cli-${cli.id}`,
      label: cli.displayName,
      icon: <CliLogo cliId={cli.id} size="sm" />,
      onSelect: () => onPick(cli.id)
    }))
}
