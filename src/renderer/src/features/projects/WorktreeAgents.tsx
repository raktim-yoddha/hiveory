import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react'
import type { CliInstanceView, CliStatus } from '@shared/domain'
import { CliLogo } from '../../components/cli/CliLogo'
import { StatusDot, STATUS_LABEL } from '../../components/ui/StatusDot'
import { shortAgo } from '../../lib/ago'
import { cx } from '../../lib/cx'
import { useAgents } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import styles from './ProjectSidebar.module.css'

const EMPTY: CliInstanceView[] = []
/** Busy first, so what is running is always in view: working, then needs you, then idle. */
const RANK: Record<CliStatus, number> = { working: 0, 'waiting-for-you': 1, idle: 2 }
/** One chip (dot + logo) plus its gap, and room kept for the "+N" chip and the toggle. */
const SLOT_PX = 38
const RESERVED_PX = 56

/** A worktree's agents and terminals, busiest first, re-sorted live as statuses change. */
const useWorktreeAgents = (workspaceId: string) => {
  const agents = useAgents((s) => s.byWorkspace[workspaceId] ?? EMPTY)
  const runtime = useAgents((s) => s.runtime)
  const load = useAgents((s) => s.load)
  useEffect(() => {
    void load(workspaceId)
  }, [workspaceId, load])
  return useMemo(
    () =>
      agents
        .map((a) => ({ agent: a, status: (runtime[a.id] ?? a.runtime).status }))
        .sort((x, y) => RANK[x.status] - RANK[y.status] || x.agent.petName.localeCompare(y.agent.petName)),
    [agents, runtime]
  )
}

/** Spins while anything in the worktree is working; in place of the old pane count (ADR 0040). */
export function WorktreeBusy({ workspaceId }: { workspaceId: string }) {
  const working = useWorktreeAgents(workspaceId).filter((a) => a.status === 'working').length
  if (!working) return null
  const label = `${working} working`
  return <Loader2 className={cx(styles.busy, 'spin')} role="img" aria-label={label} />
}

/**
 * The agents and terminals of one Worktree under its row (ADR 0039, 0040). Folded: one bar of
 * status-and-logo chips, "+N" for what doesn't fit, a chevron to unfold. Unfolded: a list with each
 * one's name, status and how long it has been in it. Every chip and row opens its pane.
 */
export function WorktreeAgents({ projectId, workspaceId }: { projectId: string; workspaceId: string }) {
  const sorted = useWorktreeAgents(workspaceId)
  const since = useAgents((s) => s.since)
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const [open, setOpen] = useState(false)
  const [fit, setFit] = useState(4)
  const barRef = useRef<HTMLDivElement>(null)
  const any = sorted.length > 0

  // How many chips fit the sidebar's width right now.
  useLayoutEffect(() => {
    const el = barRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => entry && setFit(Math.max(1, Math.floor((entry.contentRect.width - RESERVED_PX) / SLOT_PX))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [any, open])

  if (!any) return null
  const count = `${sorted.length} ${sorted.length === 1 ? 'agent' : 'agents'}`
  const statusText = (status: CliStatus): string => (status === 'waiting-for-you' ? 'Needs you' : STATUS_LABEL[status])

  if (open) {
    return (
      <div className={cx(styles.agents, styles.agentsOpen)}>
        <button type="button" className={styles.agentsHead} aria-expanded onClick={() => setOpen(false)}>
          <span>{count}</span>
          <ChevronDown aria-hidden />
        </button>
        <ul className={styles.agentList}>
          {sorted.map(({ agent, status }) => (
            <li key={agent.id}>
              <button type="button" className={styles.agentItem} onClick={() => openWorkspace(projectId, workspaceId, agent.id)}>
                <StatusDot status={status} />
                <CliLogo cliId={agent.cliId} size="sm" />
                <span className={styles.agentName}>
                  <span className={cx(status !== 'idle' && styles.agentNameStrong)}>{agent.petName}</span> · {statusText(status)}
                </span>
                <span className={styles.agentAgo}>{shortAgo(since[agent.id])}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const shown = sorted.slice(0, fit)
  const more = sorted.length - shown.length
  return (
    <div ref={barRef} className={styles.agents}>
      {shown.map(({ agent, status }) => (
        <button
          key={agent.id}
          type="button"
          className={styles.agentChip}
          aria-label={`${agent.petName}: ${statusText(status)}`}
          title={`${agent.petName} · ${statusText(status)}`}
          onClick={() => openWorkspace(projectId, workspaceId, agent.id)}
        >
          <StatusDot status={status} />
          <CliLogo cliId={agent.cliId} size="sm" />
        </button>
      ))}
      {more > 0 && <span className={styles.more}>+{more}</span>}
      <button type="button" className={styles.agentsToggle} aria-expanded={false} aria-label={`Show all ${count}`} onClick={() => setOpen(true)}>
        <ChevronRight aria-hidden />
      </button>
    </div>
  )
}
