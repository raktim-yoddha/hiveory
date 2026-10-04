import { useState } from 'react'
import { ArrowDown, ArrowRight, Plus } from 'lucide-react'
import { IconButton } from '../../components/ui/Button'
import { Menu, type MenuEntry } from '../../components/ui/Menu'
import { agentActions } from './agent-actions'
import { useAgentMenuEntries } from './useAgentMenuEntries'

interface AddAgentMenuProps {
  workspaceId: string
  /** The pane the new agent is placed beside. */
  paneId: string
}

/** The pane header "+" menu: choose Right/Bottom, then a detected CLI (ui-map.md "Pane Add Menu"). */
export function AddAgentMenu({ workspaceId, paneId }: AddAgentMenuProps) {
  const [side, setSide] = useState<'right' | 'bottom'>('right')
  const agents = useAgentMenuEntries((cliId) => void agentActions.open(workspaceId, cliId, { targetPaneId: paneId, side }))

  const items: MenuEntry[] = [
    { type: 'label', label: 'Placement' },
    { type: 'item', id: 'right', label: 'Right', icon: <ArrowRight />, checked: side === 'right', keepOpen: true, onSelect: () => setSide('right') },
    { type: 'item', id: 'bottom', label: 'Bottom', icon: <ArrowDown />, checked: side === 'bottom', keepOpen: true, onSelect: () => setSide('bottom') },
    { type: 'separator' },
    { type: 'label', label: 'Agents' },
    ...(agents.length ? agents : [{ type: 'item' as const, id: 'none', label: 'No CLIs detected', disabled: true, onSelect: () => undefined }])
  ]

  return (
    <Menu
      label="Add agent"
      align="end"
      items={items}
      trigger={(props) => <IconButton {...props} label="Add agent" icon={<Plus />} />}
    />
  )
}
