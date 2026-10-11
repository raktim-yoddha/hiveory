import { useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Maximize2, Minimize2, Pencil, Play, RotateCcw, Square, X } from 'lucide-react'
import type { CliInstanceView } from '@shared/domain'
import { CliLogo } from '../../components/cli/CliLogo'
import { Button, IconButton } from '../../components/ui/Button'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { InlineRename } from '../../components/ui/InlineRename'
import { Menu } from '../../components/ui/Menu'
import { StatusDot } from '../../components/ui/StatusDot'
import { useAgents, useClis } from '../../stores/data'
import { api } from '../../lib/api'
import { runAction } from '../../stores/notices'
import { PaneFrame } from '../panes/PaneFrame'
import type { PaneRenderProps } from '../panes/PaneLayout'
import { TerminalView } from '../terminal/TerminalView'
import { AddAgentMenu } from './AddAgentMenu'
import { AgentChatView } from './AgentChatView'
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
export function AgentPane({
  agent,
  onDragHandlePointerDown,
  highlighted,
  maximized,
  toggleMaximize,
  rect,
  minSize,
  gutter,
  moveTo
}: AgentPaneProps) {
  const runtime = useAgents((s) => s.runtime[agent.id]) ?? agent.runtime
  const cli = useClis((s) => s.clis.find((c) => c.id === agent.cliId))
  const [renaming, setRenaming] = useState(false)
  // A new name shows everywhere: sidebar, board, other agents' tools, Queen Bee and the phone (ADR 0042).
  const rename = (name: string): void => void runAction('Rename pane', () => api('agents.rename', { instanceId: agent.id, name }))
  const fits = { right: rect.width >= minSize.width * 2 + gutter, bottom: rect.height >= minSize.height * 2 + gutter }
  const moves = moveTo
    ? (['left', 'right', 'up', 'down'] as const).map((direction) => ({
        type: 'item' as const,
        id: `move-${direction}`,
        label: `Move ${direction}`,
        icon: { left: <ArrowLeft />, right: <ArrowRight />, up: <ArrowUp />, down: <ArrowDown /> }[direction],
        onSelect: () => moveTo(direction)
      }))
    : []

  return (
    <PaneFrame
      label={`${agent.petName} agent`}
      highlighted={highlighted}
      tone={runtime.running && runtime.status === 'waiting-for-you' ? 'waiting' : undefined}
      onHeaderPointerDown={onDragHandlePointerDown}
      onHeaderDoubleClick={toggleMaximize}
      header={
        <>
          {/* Right-click the name for the agent's actions; right-click twice to rename it (ADR 0042). */}
          {renaming ? (
            <span className={styles.identity}>
              <CliLogo cliId={agent.cliId} />
              <InlineRename value={agent.petName} label={`Rename ${agent.petName}`} onCommit={rename} onDone={() => setRenaming(false)} />
            </span>
          ) : (
            <Menu
              label={`${agent.petName} actions`}
              context
              onDoubleContext={() => setRenaming(true)}
              items={[
                agent.chatUi
                  ? {
                      type: 'item',
                      id: 'restart',
                      label: 'Stop reply',
                      icon: <Square />,
                      disabled: runtime.status !== 'working',
                      onSelect: () => void agentActions.restart(agent.id)
                    }
                  : {
                      type: 'item',
                      id: 'restart',
                      label: runtime.running ? 'Restart' : 'Start',
                      icon: runtime.running ? <RotateCcw /> : <Play />,
                      onSelect: () => void agentActions.restart(agent.id)
                    },
                { type: 'item', id: 'rename', label: 'Rename', icon: <Pencil />, hint: 'Right-click twice', onSelect: () => setRenaming(true) },
                ...(moves.length ? [{ type: 'separator' as const }, ...moves] : []),
                { type: 'separator' },
                { type: 'item', id: 'close', label: 'Close', icon: <X />, danger: true, onSelect: () => void agentActions.close(agent) }
              ]}
              trigger={(props) => (
                <button type="button" {...props} className={styles.identity} data-pane-grip aria-label={`${agent.petName} actions`} title="Right-click for actions, twice to rename">
                  <CliLogo cliId={agent.cliId} />
                  <span className={styles.name}>{agent.petName}</span>
                  {/* The dot is the only status signal and takes no room, so it stays at any width. */}
                  <span className={styles.status}>
                    <StatusDot status={runtime.status} running={runtime.running} detail={runtime.activity} />
                  </span>
                </button>
              )}
            />
          )}
          <span className={styles.actions}>
            <span data-pane-optional="add">
              <AddAgentMenu workspaceId={agent.workspaceId} paneId={agent.id} fits={fits} />
            </span>
            <IconButton
              data-pane-optional="maximize"
              label={maximized ? `Restore ${agent.petName}` : `Maximize ${agent.petName}`}
              icon={maximized ? <Minimize2 /> : <Maximize2 />}
              onClick={toggleMaximize}
            />
            <IconButton label={`Close ${agent.petName}`} icon={<X />} onClick={() => void agentActions.close(agent)} />
          </span>
        </>
      }
    >
      <ErrorBoundary region={agent.chatUi ? 'Chat' : 'Terminal'} compact resetKey={agent.id}>
        {agent.chatUi ? <AgentChatView instanceId={agent.id} /> : <TerminalView instanceId={agent.id} minColumns={cli?.minColumns} minRows={cli?.minRows} />}
      </ErrorBoundary>
      {!runtime.running && !agent.chatUi && (
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
