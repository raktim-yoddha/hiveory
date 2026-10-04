import { useEffect, useState } from 'react'
import { Bot, ChevronDown, Layers, Settings2 } from 'lucide-react'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Menu, type MenuEntry } from '../../components/ui/Menu'
import { usePresets } from '../../stores/data'
import { agentActions } from '../agents/agent-actions'
import { useAgentMenuEntries } from '../agents/useAgentMenuEntries'
import { PresetsDialog } from '../presets/PresetsDialog'

/**
 * A Workspace with zero agent panes. Only here — never on the Project page —
 * are "Open agent" and "Load preset" offered (AGENTS.md rule 11).
 */
export function EmptyWorkspace({ workspaceId }: { workspaceId: string }) {
  const agents = useAgentMenuEntries((cliId) => void agentActions.open(workspaceId, cliId))
  const { presets, loaded, load } = usePresets()
  const [managing, setManaging] = useState(false)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const presetItems: MenuEntry[] = [
    ...presets.map((preset) => ({
      type: 'item' as const,
      id: preset.id,
      label: preset.name,
      icon: <Layers />,
      hint: `${preset.cliSelections.reduce((n, s) => n + s.count, 0)} agents`,
      onSelect: () => void agentActions.applyPreset(workspaceId, preset.id)
    })),
    ...(presets.length ? [{ type: 'separator' as const }] : []),
    { type: 'item', id: 'manage', label: presets.length ? 'Manage presets…' : 'Create a preset…', icon: <Settings2 />, onSelect: () => setManaging(true) }
  ]

  return (
    <>
      <EmptyState
        icon={<Bot />}
        title="Empty workspace"
        description="Open an agent to start working, or load a preset to open several at once."
        actions={
          <>
            <Menu
              label="Open agent"
              items={agents}
              empty="No supported CLIs were detected."
              trigger={(props) => (
                <Button {...props} variant="primary" size="lg">
                  Open agent <ChevronDown />
                </Button>
              )}
            />
            <Menu
              label="Load preset"
              items={presetItems}
              trigger={(props) => (
                <Button {...props} size="lg">
                  Load preset <ChevronDown />
                </Button>
              )}
            />
          </>
        }
      />
      {managing && <PresetsDialog onClose={() => setManaging(false)} />}
    </>
  )
}
