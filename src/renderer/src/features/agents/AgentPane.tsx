import { Maximize2, Minimize2, MoreHorizontal, Play, RotateCcw, X } from 'lucide-react'
import type { CliInstanceView } from '@shared/domain'
import { CliLogo } from '../../components/cli/CliLogo'
import { Button, IconButton } from '../../components/ui/Button'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { Menu } from '../../components/ui/Menu'
import { StatusDot } from '../../components/ui/StatusDot'
import { useAgents } from '../../stores/data'
import { PaneFrame } from '../panes/PaneFrame'
import type { PaneRenderProps } from '../panes/PaneLayout'
import { TerminalView } from '../terminal/TerminalView'
import { AddAgentMenu } from './AddAgentMenu'
import { agentActions } from './agent-actions'
import styles from './AgentPane.module.css'

interface AgentPaneProps extends PaneRenderProps {
  agent: CliInstanceView
  highlighted?: boolean
}

/**
 * One agent instance's pane: identity header + its own terminal. Status is
 * conveyed by the dot's color alone; the reason is in its accessible label.
 */
export function AgentPane({ agent, onDragHandlePointerDown, highlighted, maximized, toggleMaximize }: AgentPaneProps) {
  const runtime = useAgents((s) => s.runtime[agent.id]) ?? agent.runtime

  return (
    <PaneFrame
      label={`${agent.petName} agent`}
      highlighted={highlighted}
      tone={runtime.running && runtime.status === 'waiting-for-you' ? 'waiting' : undefined}
      onHeaderPointerDown={onDragHandlePointerDown}
      onHeaderDoubleClick={toggleMaximize}
      header={
        <>
          <CliLogo cliId={agent.cliId} />
          <span className={styles.name}>{agent.petName}</span>
          <StatusDot status={runtime.status} running={runtime.running} detail={runtime.activity} />
          <span className={styles.spacer} />
          <AddAgentMenu workspaceId={agent.workspaceId} paneId={agent.id} />
          <IconButton
            label={maximized ? `Restore ${agent.petName}` : `Maximize ${agent.petName}`}
            icon={maximized ? <Minimize2 /> : <Maximize2 />}
            onClick={toggleMaximize}
          />
          <Menu
            label={`${agent.petName} actions`}
            align="end"
            items={[
              {
                type: 'item',
                id: 'restart',
                label: runtime.running ? 'Restart' : 'Start',
                icon: runtime.running ? <RotateCcw /> : <Play />,
                onSelect: () => void agentActions.restart(agent.id)
              },
              { type: 'separator' },
              { type: 'item', id: 'close', label: 'Close agent', icon: <X />, danger: true, onSelect: () => void agentActions.close(agent) }
            ]}
            trigger={(props) => <IconButton {...props} label={`${agent.petName} actions`} icon={<MoreHorizontal />} />}
          />
          <IconButton label={`Close ${agent.petName}`} icon={<X />} onClick={() => void agentActions.close(agent)} />
        </>
      }
    >
      <ErrorBoundary region="Terminal" compact resetKey={agent.id}>
        <TerminalView instanceId={agent.id} />
      </ErrorBoundary>
      {!runtime.running && (
        <div className={styles.stopped}>
          <p className={styles.stoppedTitle}>{runtime.error ? 'Agent stopped' : runtime.activity ?? 'Not running'}</p>
          {runtime.error && <p className={styles.stoppedError}>{runtime.error}</p>}
          <Button size="sm" variant="primary" icon={<Play />} onClick={() => void agentActions.restart(agent.id)}>
            {agent.hasConversation ? 'Resume session' : 'Start agent'}
          </Button>
        </div>
      )}
    </PaneFrame>
  )
}
