import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, FileCode2, Globe, Loader2 } from 'lucide-react'
import type { BrowserPageView, CliInstanceView, CliStatus, EditorView } from '@shared/domain'
import { CliLogo } from '../../components/cli/CliLogo'
import { StatusDot, STATUS_LABEL } from '../../components/ui/StatusDot'
import { shortAgo } from '../../lib/ago'
import { cx } from '../../lib/cx'
import { useAgents, useClis } from '../../stores/data'
import { useBrowser } from '../../stores/browser'
import { useEditors } from '../../stores/editors'
import { pageTitle } from '../browser/page-title'
import { useNavigation } from '../../stores/navigation'
import styles from './ProjectSidebar.module.css'

const EMPTY: CliInstanceView[] = []
/** Busy first, so what is running is always in view: working, then needs you, then idle. */
const RANK: Record<CliStatus, number> = { working: 0, 'waiting-for-you': 1, idle: 2 }
/** Room for the "+N" count, used only when not every chip fits. */
const MORE_PX = 24

/**
 * A worktree's agents and terminals, busiest first, re-sorted live as statuses change. Terminals have
 * no status (Hiveory tracks agents, not shells; ADR 0044): they come after the agents.
 */
const useWorktreeAgents = (workspaceId: string) => {
  const agents = useAgents((s) => s.byWorkspace[workspaceId] ?? EMPTY)
  const runtime = useAgents((s) => s.runtime)
  const load = useAgents((s) => s.load)
  const clis = useClis((s) => s.clis)
  useEffect(() => {
    void load(workspaceId)
  }, [workspaceId, load])
  return useMemo(() => {
    const shell = new Set(clis.filter((c) => c.kind === 'shell').map((c) => c.id))
    return agents
      .map((a) => ({ agent: a, status: shell.has(a.cliId) ? undefined : (runtime[a.id] ?? a.runtime).status }))
      .sort((x, y) => (x.status ? RANK[x.status] : 3) - (y.status ? RANK[y.status] : 3) || x.agent.petName.localeCompare(y.agent.petName))
  }, [agents, runtime, clis])
}

/** Spins while anything in the worktree is working; in place of the old pane count (ADR 0040). */
export function WorktreeBusy({ workspaceId }: { workspaceId: string }) {
  const working = useWorktreeAgents(workspaceId).filter((a) => a.status === 'working').length
  if (!working) return null
  const label = `${working} working`
  return <Loader2 className={cx(styles.busy, 'spin')} role="img" aria-label={label} />
}

/** One pane of a worktree as the bar and its list show it. */
interface PaneEntry {
  id: string
  name: string
  icon: ReactNode
  /** Agents and terminals only: their status dot. */
  status?: CliStatus
  detail: string
}

const NO_PAGES: BrowserPageView[] = []
const NO_EDITORS: EditorView[] = []

/**
 * Every pane of one Worktree under its row (ADR 0039, 0040, 0042): agents and terminals (busiest
 * first), then browser pages and open files. Folded: one bar of chips, "+N" for what doesn't fit; a
 * click anywhere on it unfolds it. Unfolded: "N panes", each with its name and state. Every row opens its pane.
 */
export function WorktreeAgents({ projectId, workspaceId }: { projectId: string; workspaceId: string }) {
  const sorted = useWorktreeAgents(workspaceId)
  const since = useAgents((s) => s.since)
  const allPages = useBrowser((s) => s.pages)
  const pages = useMemo(() => (allPages.some((p) => p.scope === workspaceId) ? allPages.filter((p) => p.scope === workspaceId) : NO_PAGES), [allPages, workspaceId])
  const editors = useEditors((s) => s.byWorkspace[workspaceId] ?? NO_EDITORS)
  const openWorkspace = useNavigation((s) => s.openWorkspace)
  const [open, setOpen] = useState(false)
  const [fit, setFit] = useState(Infinity)
  const barRef = useRef<HTMLButtonElement>(null)
  const statusText = (status: CliStatus): string => (status === 'waiting-for-you' ? 'Needs you' : STATUS_LABEL[status])
  const entries: PaneEntry[] = [
    ...sorted.map(({ agent, status }) => ({ id: agent.id, name: agent.petName, icon: <CliLogo cliId={agent.cliId} size="sm" />, status, detail: status ? statusText(status) : 'Terminal' })),
    ...pages.map((page) => ({ id: page.id, name: page.ownerName ? `${page.ownerName} · ${pageTitle(page)}` : pageTitle(page), icon: <Globe className={styles.paneIcon} aria-hidden />, detail: 'Browser' })),
    ...editors.map((editor) => ({ id: editor.id, name: editor.name, icon: <FileCode2 className={styles.paneIcon} aria-hidden />, detail: 'File' }))
  ]
  const total = entries.length

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
  const count = `${total} ${total === 1 ? 'pane' : 'panes'}`

  if (open) {
    return (
      <div className={cx(styles.agents, styles.agentsOpen)}>
        <button type="button" className={styles.agentsHead} aria-expanded onClick={() => setOpen(false)}>
          <span>{count}</span>
          <ChevronDown aria-hidden />
        </button>
        <ul className={styles.agentList}>
          {entries.map((e) => (
            <li key={e.id}>
              <button type="button" className={styles.agentItem} onClick={() => openWorkspace(projectId, workspaceId, e.id)}>
                {e.status ? <StatusDot status={e.status} /> : <span className={styles.noDot} aria-hidden />}
                {e.icon}
                <span className={styles.agentName}>
                  <span className={cx(e.status && e.status !== 'idle' && styles.agentNameStrong)}>{e.name}</span> · {e.detail}
                </span>
                {e.status && <span className={styles.agentAgo}>{shortAgo(since[e.id])}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  const shown = entries.slice(0, fit)
  const more = total - shown.length
  return (
    // Folded, the bar is one button that unfolds the list; its chips only show what is there (ADR 0040).
    <button
      ref={barRef}
      type="button"
      className={cx(styles.agents, styles.agentsBar)}
      aria-expanded={false}
      aria-label={`Show all ${count}: ${entries.map((e) => `${e.name}, ${e.detail}`).join('; ')}`}
      onClick={() => setOpen(true)}
    >
      {shown.map((e) => (
        <span key={e.id} data-chip className={styles.agentChip} title={`${e.name} · ${e.detail}`}>
          {e.status && <StatusDot status={e.status} />}
          {e.icon}
        </span>
      ))}
      {more > 0 && <span className={styles.more}>+{more}</span>}
      <span data-toggle className={styles.agentsToggle} aria-hidden>
        <ChevronRight />
      </span>
    </button>
  )
}
