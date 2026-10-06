import { useState } from 'react'
import { Monitor, MonitorPlay, Play, Square } from 'lucide-react'
import type { BotComputerStatus } from '@shared/domain/bot'
import { IconButton } from '../../components/ui/Button'
import { Menu } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { runAction } from '../../stores/notices'

const LABEL: Record<BotComputerStatus['state'], string> = {
  off: 'No computer',
  unavailable: 'Unavailable',
  missing: 'Not created yet',
  stopped: 'Stopped',
  running: 'Running'
}

/**
 * The bot's own Linux computer (ADR 0022): its state, start/stop, and "take control",
 * which opens the desktop in the browser on a loopback address.
 */
export function ComputerMenu({ botId }: { botId: string }) {
  const [status, setStatus] = useState<BotComputerStatus | null>(null)
  const act = async (action: 'status' | 'start' | 'stop' | 'takeControl', label: string): Promise<void> => {
    const next = await runAction(label, () => api('bots.computer', { botId, action }))
    if (next) setStatus(next)
  }
  const state = status?.state
  return (
    <Menu
      label="Bot computer"
      align="end"
      items={[
        { type: 'label', label: `${state ? `Computer: ${LABEL[state]}` : 'Computer: checking…'}${status?.detail ? ` · ${status.detail}` : ''}` },
        { type: 'separator' },
        { type: 'item', id: 'take', label: 'Take control', icon: <MonitorPlay />, onSelect: () => void act('takeControl', 'Open the desktop') },
        ...(state === 'running'
          ? [{ type: 'item' as const, id: 'stop', label: 'Stop computer', icon: <Square />, onSelect: () => void act('stop', 'Stop the computer') }]
          : [{ type: 'item' as const, id: 'start', label: 'Start computer', icon: <Play />, onSelect: () => void act('start', 'Start the computer') }])
      ]}
      trigger={(props) => (
        <IconButton
          {...props}
          label="Bot computer"
          icon={<Monitor />}
          onClick={() => {
            props.onClick?.()
            void act('status', 'Check the computer')
          }}
        />
      )}
    />
  )
}
