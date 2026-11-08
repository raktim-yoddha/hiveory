import { useMemo } from 'react'
import { CheckCircle2, Circle, Loader2 } from 'lucide-react'
import type { ChatSession, ChatTask } from '@shared/domain/chat'
import type { CliInstanceView } from '@shared/domain'
import { CliLogo } from '../../components/cli/CliLogo'
import { Popover } from '../../components/ui/Popover'
import { StatusDot } from '../../components/ui/StatusDot'
import { cx } from '../../lib/cx'
import { useAgents } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { DiffStat } from '../changes/ChangesPanel'
import { showChanges } from '../changes/changes-store'
import { useChangeSet } from '../changes/useChangeSet'
import composer from './Composer.module.css'

const EMPTY: CliInstanceView[] = []
const UNCOMMITTED = { kind: 'uncommitted' } as const

/** The agent's latest to-do list, from the newest reply that has one. */
const latestTasks = (chat: ChatSession): ChatTask[] => [...chat.messages].reverse().find((m) => m.tasks?.length)?.tasks ?? []

interface ComposerTracksProps {
  chat: ChatSession
  /** The worktree the chat works in: its changes and the agent's subagents. */
  workspaceId?: string
  projectId?: string
}

/**
 * The strip above the message box (ADR 0058, after Paseo's): the agent's to-do list ("4/6 tasks"), the
 * subagents it opened, and the worktree's uncommitted changes ("+1.9k −684", opens the Changes tab).
 * Each shows only when it has something to say.
 */
export function ComposerTracks({ chat, workspaceId, projectId }: ComposerTracksProps) {
  const tasks = useMemo(() => latestTasks(chat), [chat])
  const agents = useAgents((s) => (workspaceId ? (s.byWorkspace[workspaceId] ?? EMPTY) : EMPTY))
  const subagents = useMemo(() => (chat.agentId ? agents.filter((a) => a.parentId === chat.agentId) : EMPTY), [agents, chat.agentId])
  const { changes } = useChangeSet(workspaceId, UNCOMMITTED)
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const changed = changes && (changes.additions > 0 || changes.deletions > 0 || changes.files.length > 0)
  if (!tasks.length && !subagents.length && !changed) return null
  const done = tasks.filter((t) => t.status === 'completed').length

  return (
    <div className={composer.tracks}>
      {tasks.length > 0 && (
        <Popover
          label="The agent's tasks"
          placement="above"
          trigger={(props) => (
            <button type="button" {...props} className={composer.track} aria-label={`${done} of ${tasks.length} tasks done`}>
              {done < tasks.length ? <Loader2 aria-hidden className={cx('spin', composer.trackSpin)} /> : <CheckCircle2 aria-hidden />}
              {done}/{tasks.length} tasks
            </button>
          )}
        >
          {() => (
            <ol className={composer.trackList} aria-label="Tasks">
              {tasks.map((t, i) => (
                <li key={`${i}:${t.text}`} className={cx(composer.trackRow, t.status === 'completed' && composer.taskDone)}>
                  {t.status === 'completed' ? <CheckCircle2 aria-label="Done" /> : t.status === 'in_progress' ? <Loader2 aria-label="In progress" className="spin" /> : <Circle aria-label="To do" />}
                  <span>{t.text}</span>
                </li>
              ))}
            </ol>
          )}
        </Popover>
      )}
      {subagents.length > 0 && (
        <Popover
          label="Subagents"
          placement="above"
          trigger={(props) => (
            <button type="button" {...props} className={composer.track}>
              {subagents.slice(0, 3).map((a) => (
                <StatusDot key={a.id} status={a.runtime.status} running={a.runtime.running} />
              ))}
              {subagents.length} {subagents.length === 1 ? 'subagent' : 'subagents'}
            </button>
          )}
        >
          {(close) => (
            <ul className={composer.trackList} aria-label="Subagents">
              {subagents.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className={composer.trackRowButton}
                    onClick={() => {
                      if (projectId) openWorkspace(projectId, a.workspaceId, a.id)
                      close()
                    }}
                  >
                    <CliLogo cliId={a.cliId} size="sm" />
                    <span className={composer.trackName}>{a.petName}</span>
                    {a.model && <span className={composer.trackMeta}>{a.model}</span>}
                    <StatusDot status={a.runtime.status} running={a.runtime.running} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Popover>
      )}
      {changed && workspaceId && (
        <button type="button" className={composer.track} onClick={() => showChanges(workspaceId, UNCOMMITTED)} title="Open the worktree's changes">
          <DiffStat additions={changes.additions} deletions={changes.deletions} />
        </button>
      )}
    </div>
  )
}
