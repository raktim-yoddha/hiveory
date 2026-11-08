import { useEffect, type ReactNode } from 'react'
import { Play } from 'lucide-react'
import type { CliInstanceView } from '@shared/domain'
import { Button } from '../../components/ui/Button'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { useAgents, useApp, useClis, useProjects, useWorkspaces } from '../../stores/data'
import { PaneFrame } from '../panes/PaneFrame'
import { registerPaneCloser } from '../panes/pane-commands'
import type { PaneRenderProps } from '../panes/PaneLayout'
import { openTerminalLink } from '../terminal/open-terminal-link'
import { TerminalView } from '../terminal/TerminalView'
import { AgentChatView } from './AgentChatView'
import { agentActions } from './agent-actions'
import styles from './AgentPane.module.css'

interface AgentPaneProps extends PaneRenderProps {
  agent: CliInstanceView
  highlighted?: boolean
  /** The area's tabs (ADR 0042), the pane's header. */
  tabStrip: ReactNode
}

/**
 * One agent instance's pane: its area's tabs + its own terminal (or chat). An agent that needs
 * you tints the frame.
 */
export function AgentPane({ agent, onDragHandlePointerDown, highlighted, toggleMaximize, concealed, tabStrip }: AgentPaneProps) {
  const runtime = useAgents((s) => s.runtime[agent.id]) ?? agent.runtime
  const cli = useClis((s) => s.clis.find((c) => c.id === agent.cliId))
  // Dropped files are paths on this computer: only a terminal running here can use them (ADR 0061).
  const elsewhere = useProjects((s) => Boolean(s.projects.find((p) => p.id === agent.projectId)?.host))
  const info = useApp((s) => s.info)
  const dropFiles = elsewhere || info?.client ? false : info?.platform === 'win32' ? 'windows' : 'posix'
  // Links in the output open beside the pane: web pages in a browser pane, worktree files in an editor.
  const root = useWorkspaces((s) => s.byProject[agent.projectId]?.find((w) => w.id === agent.workspaceId)?.path)
  const onLink = root ? (link: Parameters<typeof openTerminalLink>[0]) => void openTerminalLink(link, { workspaceId: agent.workspaceId, root, paneId: agent.id }) : undefined
  // A terminal has no status to show: Hiveory tracks agents, not shells (ADR 0044).
  const tracked = cli?.kind !== 'shell'
  useEffect(() => registerPaneCloser(agent.id, () => void agentActions.close(agent)), [agent])
  return (
    <PaneFrame
      label={`${agent.petName} agent`}
      highlighted={highlighted}
      tone={tracked && runtime.running && runtime.status === 'waiting-for-you' ? 'waiting' : undefined}
      onHeaderPointerDown={onDragHandlePointerDown}
      onHeaderDoubleClick={toggleMaximize}
      tabStrip={tabStrip}
    >
      <ErrorBoundary region={agent.chatUi ? 'Chat' : 'Terminal'} compact resetKey={agent.id}>
        {agent.chatUi ? <AgentChatView instanceId={agent.id} /> : <TerminalView instanceId={agent.id} minColumns={cli?.minColumns} minRows={cli?.minRows} dropFiles={dropFiles} onLink={onLink} concealed={concealed} />}
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
