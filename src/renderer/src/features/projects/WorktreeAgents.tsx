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
/** Room for the "+N" count, used only when not every chip fits. */
const MORE_PX = 24

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
 * status-and-logo chips, "+N" for what doesn't fit; a click anywhere on it unfolds it. Unfolded: a list with each
 * one's name, status and how long it has been in it. Every chip and row opens its pane.
 */
export function WorktreeAgents({ projectId, workspaceId }: { projectId: string; workspaceId: string }) {
  const sorted = useWorktreeAgents(workspaceId)
  const since = useAgents((s) => s.since)
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const [open, setOpen] = useState(false)
  const [fit, setFit] = useState(Infinity)
  const barRef = useRef<HTMLButtonElement>(null)
  const total = sorted.length

  // How many chips fit the bar right now, measured from a real chip; "+N" only when they don't all fit.
  useLayoutEffect(() => {
    const el = barRef.current
    if (!el) return
    const measure = (): void => {
      const style = getComputedStyle(el)
      const gap = parseFloat(style.columnGap) || 0
      const inner = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const chip = (el.querySelector<HTMLElement>('[data-chip]')?.offsetWidth ?? 36) + gap
      const room = inner - (el.querySelector<HTMLElement>('[data-toggle]')?.offsetWidth ?? 20) - gap
      const all = Math.floor((room + gap) / chip)
      setFit(all >= total ? total : Math.max(1, Math.floor((room - MORE_PX) / chip)))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [total, open])

  if (!total) return null
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
    // Folded, the bar is one button that unfolds the list; its chips only show who is there (ADR 0040).
    <button
      ref={barRef}
      type="button"
      className={cx(styles.agents, styles.agentsBar)}
      aria-expanded={false}
      aria-label={`Show all ${count}: ${sorted.map(({ agent, status }) => `${agent.petName}, ${statusText(status)}`).join('; ')}`}
      onClick={() => setOpen(true)}
    >
      {shown.map(({ agent, status }) => (
        <span key={agent.id} data-chip className={styles.agentChip} title={`${agent.petName} · ${statusText(status)}`}>
          <StatusDot status={status} />
          <CliLogo cliId={agent.cliId} size="sm" />
        </span>
      ))}
      {more > 0 && <span className={styles.more}>+{more}</span>}
      <span data-toggle className={styles.agentsToggle} aria-hidden>
        <ChevronRight />
      </span>
    </button>
  )
}
