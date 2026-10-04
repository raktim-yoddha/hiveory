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
  /** Whether a split in each direction still leaves both panes above their minimum size. */
  fits: { right: boolean; bottom: boolean }
}

/** The pane header "+" menu: choose Right/Bottom, then a detected CLI (ui-map.md "Pane Add Menu"). */
export function AddAgentMenu({ workspaceId, paneId, fits }: AddAgentMenuProps) {
  const [preferred, setSide] = useState<'right' | 'bottom'>('right')
  // Fall back to whichever direction fits; if neither does, the agent docks along the layout edge.
  const side = fits[preferred] ? preferred : fits.right ? 'right' : fits.bottom ? 'bottom' : null
  const agents = useAgentMenuEntries(
    (cliId) => void agentActions.open(workspaceId, cliId, side ? { targetPaneId: paneId, side } : undefined)
  )

  const items: MenuEntry[] = [
    { type: 'label', label: 'Placement' },
    { type: 'item', id: 'right', label: 'Right', icon: <ArrowRight />, checked: side === 'right', disabled: !fits.right, hint: fits.right ? undefined : 'Too narrow', keepOpen: true, onSelect: () => setSide('right') },
    { type: 'item', id: 'bottom', label: 'Bottom', icon: <ArrowDown />, checked: side === 'bottom', disabled: !fits.bottom, hint: fits.bottom ? undefined : 'Too short', keepOpen: true, onSelect: () => setSide('bottom') },
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
