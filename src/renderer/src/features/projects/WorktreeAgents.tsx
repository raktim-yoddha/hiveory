import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { CliInstanceView, CliStatus } from '@shared/domain'
import { CliLogo } from '../../components/cli/CliLogo'
import { cx } from '../../lib/cx'
import { useAgents } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import styles from './ProjectSidebar.module.css'

const EMPTY: CliInstanceView[] = []
/** Busy first, so what is running is always in view: working, then needs you, then idle. */
const RANK: Record<CliStatus, number> = { working: 0, 'waiting-for-you': 1, idle: 2 }
/** One logo plus its gap (icon-md + space-2), and room kept for the "+N" chip and the toggle. */
const SLOT_PX = 20
const RESERVED_PX = 52

/**
 * The agents and terminals of one Worktree as a line of CLI logos under its row (ADR 0039): the
 * working ones first, re-sorted live as statuses change, "+N" for what doesn't fit, and a toggle
 * that shows them all. Each logo opens its pane.
 */
export function WorktreeAgents({ projectId, workspaceId }: { projectId: string; workspaceId: string }) {
  const agents = useAgents((s) => s.byWorkspace[workspaceId] ?? EMPTY)
  const runtime = useAgents((s) => s.runtime)
  const load = useAgents((s) => s.load)
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const [open, setOpen] = useState(false)
  const [fit, setFit] = useState(6)
  const lineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void load(workspaceId)
  }, [workspaceId, load])

  const sorted = useMemo(
    () =>
      agents
        .map((a) => ({ agent: a, status: (runtime[a.id] ?? a.runtime).status }))
        .sort((x, y) => RANK[x.status] - RANK[y.status] || x.agent.petName.localeCompare(y.agent.petName)),
    [agents, runtime]
  )
  const any = sorted.length > 0

  // How many logos fit the sidebar's width right now.
  useLayoutEffect(() => {
    const el = lineRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => entry && setFit(Math.max(1, Math.floor((entry.contentRect.width - RESERVED_PX) / SLOT_PX))))
    observer.observe(el)
    return () => observer.disconnect()
  }, [any])

  if (!any) return null
  const shown = open ? sorted : sorted.slice(0, fit)
  const more = sorted.length - shown.length

  return (
    <div ref={lineRef} className={cx(styles.agents, open && styles.agentsOpen)}>
      {shown.map(({ agent, status }) => (
        <button
          key={agent.id}
          type="button"
          className={cx(styles.agent, status === 'working' && styles.agentWorking, status === 'waiting-for-you' && styles.agentWaiting)}
          aria-label={`${agent.petName}: ${status === 'waiting-for-you' ? 'needs you' : status}`}
          title={`${agent.petName} · ${status === 'waiting-for-you' ? 'needs you' : status}`}
          onClick={() => openWorkspace(projectId, workspaceId, agent.id)}
        >
          <CliLogo cliId={agent.cliId} size="sm" />
        </button>
      ))}
      {more > 0 && <span className={styles.more}>+{more}</span>}
      {sorted.length > fit && (
        <button
          type="button"
          className={styles.agentsToggle}
          aria-expanded={open}
          aria-label={open ? 'Show fewer agents' : `Show all ${sorted.length} agents`}
          onClick={() => setOpen(!open)}
        >
          <ChevronDown className={cx(open && styles.flipped)} aria-hidden />
        </button>
      )}
    </div>
  )
}
