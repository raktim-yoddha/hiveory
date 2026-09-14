import { Activity, AlertTriangle, CalendarClock, CheckCircle2, ChevronRight, MessageSquare, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  hiveoryClient,
  type AgentDashboard,
  type AgentRunSummary,
  type CodeRunSummary,
  type GlobalDashboardChatTurn,
  type RoutineExecution,
  type RoutineSummary,
} from '../../../shared/api/hiveory-client'

type DashboardSource = 'code' | 'agent' | 'chat' | 'automation'
type DashboardGroup = 'attention' | 'working' | 'waiting' | 'recent'
type DashboardItem = {
  id: string
  source: DashboardSource
  group: DashboardGroup
  title: string
  detail: string
  state: string
  updatedAt: number
  workspaceId?: string
  agentId?: string
  routineId?: string
  conversationId?: string
}

const sourceLabel: Record<DashboardSource, string> = { code: 'Code', agent: 'Agent', chat: 'Chat', automation: 'Automation' }
const groupMeta: Array<{ id: DashboardGroup; title: string; empty: string }> = [
  { id: 'attention', title: 'Needs attention', empty: 'Nothing needs your attention.' },
  { id: 'working', title: 'Working now', empty: 'No work is running right now.' },
  { id: 'waiting', title: 'Waiting and scheduled', empty: 'No queued work or upcoming schedules.' },
  { id: 'recent', title: 'Recent activity', empty: 'No activity in the last seven days.' },
]

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'now'
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`
  return `${Math.floor(seconds / 86_400)}d ago`
}

function addAgentItems(dashboard: AgentDashboard): DashboardItem[] {
  const agents = new Map(dashboard.agents.map((agent) => [agent.id, agent.name]))
  const runItem = (run: AgentRunSummary): DashboardItem => ({
    id: `agent:${run.id}`,
    source: 'agent',
    group: run.state === 'awaiting_approval' || run.state === 'awaiting_input' || run.state === 'failed' ? 'attention' : run.state === 'running' || run.state === 'preparing' ? 'working' : run.state === 'queued' ? 'waiting' : 'recent',
    title: agents.get(run.agent_id) ?? 'Agent',
    detail: run.prompt_preview || 'Agent run',
    state: run.state.replaceAll('_', ' '),
    updatedAt: Number(run.updated_at_unix_ms),
    agentId: run.agent_id,
  })
  const runIds = new Set(dashboard.active_runs.map((run) => run.id))
  return [...dashboard.active_runs, ...dashboard.recent_runs.filter((run) => !runIds.has(run.id))].map(runItem)
}

function addCodeItems(runs: CodeRunSummary[]): DashboardItem[] {
  return runs.map((run) => ({
    id: `code:${run.id}`,
    source: 'code',
    group: run.state === 'blocked' || run.state === 'failed' ? 'attention' : run.state === 'running' ? 'working' : ['draft', 'ready', 'paused'].includes(run.state) ? 'waiting' : 'recent',
    title: run.title,
    detail: `${run.completed_tasks}/${run.task_count} tasks · ${run.objective}`,
    state: run.state,
    updatedAt: Number(run.updated_at_unix_ms),
    workspaceId: run.workspace_id,
  }))
}

function addChatItems(turns: GlobalDashboardChatTurn[]): DashboardItem[] {
  return turns.map((turn) => ({
    id: `chat:${turn.turn_id}`,
    source: 'chat',
    group: turn.state === 'failed' ? 'attention' : turn.state === 'streaming' ? 'working' : turn.state === 'queued' ? 'waiting' : 'recent',
    title: turn.conversation_title || 'Chat conversation',
    detail: 'Chat turn',
    state: turn.state.replaceAll('_', ' '),
    updatedAt: Number(turn.updated_at_unix_ms),
    conversationId: turn.conversation_id,
  }))
}

function addAutomationItems(routines: RoutineSummary[], executions: Map<string, RoutineExecution[]>): DashboardItem[] {
  const now = Date.now()
  return routines.flatMap((routine) => {
    const latest = executions.get(routine.id)?.[0]
    const latestItem = latest ? [{
      id: `automation:${routine.id}:execution:${latest.id}`,
      source: 'automation' as const,
      group: latest.state === 'awaiting_approval' || latest.state === 'failed' || latest.state === 'unknown_outcome' ? 'attention' as const : latest.state === 'running' ? 'working' as const : 'recent' as const,
      title: routine.name,
      detail: latest.report || routine.description || `Last execution for ${routine.agent_name}`,
      state: latest.state.replaceAll('_', ' '),
      updatedAt: Number(latest.updated_at_unix_ms),
      routineId: routine.id,
    }] : []
    const scheduledItem = routine.enabled && routine.next_run_unix_ms && Number(routine.next_run_unix_ms) <= now + 7 * 86_400_000 ? [{
      id: `automation:${routine.id}:schedule`,
      source: 'automation' as const,
      group: 'waiting' as const,
      title: routine.name,
      detail: `${routine.agent_name} · ${routine.schedule.timezone}`,
      state: `next ${new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(Number(routine.next_run_unix_ms)))}`,
      updatedAt: Number(routine.next_run_unix_ms),
      routineId: routine.id,
    }] : []
    return [...latestItem, ...scheduledItem]
  })
}

export function HiveoryGlobalDashboard({ onOpenSource }: { onOpenSource: (item: DashboardItem) => void }) {
  const [items, setItems] = useState<DashboardItem[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [filter, setFilter] = useState<'all' | DashboardSource>('all')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const snapshot = await hiveoryClient.globalDashboard()
      const executionResults = await Promise.allSettled(snapshot.routines.map((routine) => hiveoryClient.routineExecutions({ routine_id: routine.id, limit: 1 })))
      const executions = new Map<string, RoutineExecution[]>()
      executionResults.forEach((result, index) => {
        if (result.status === 'fulfilled') executions.set(snapshot.routines[index].id, result.value)
      })
      setItems([
        ...addCodeItems(snapshot.code_runs),
        ...(snapshot.agent_dashboard ? addAgentItems(snapshot.agent_dashboard) : []),
        ...addChatItems(snapshot.chat_turns),
        ...addAutomationItems(snapshot.routines, executions),
      ])
      setErrors(snapshot.source_errors)
    } catch {
      setErrors(['The global dashboard could not be loaded.'])
    }
    setLoading(false)
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const interval = window.setInterval(() => void refresh(), 30_000)
    const onFocus = () => void refresh()
    window.addEventListener('focus', onFocus)
    return () => { window.clearInterval(interval); window.removeEventListener('focus', onFocus) }
  }, [refresh])

  const visible = useMemo(() => items.filter((item) => {
    const needle = query.trim().toLocaleLowerCase()
    return (filter === 'all' || item.source === filter) && (!needle || `${item.title} ${item.detail} ${item.state}`.toLocaleLowerCase().includes(needle))
  }), [filter, items, query])
  const counts = useMemo(() => Object.fromEntries(groupMeta.map(({ id }) => [id, visible.filter((item) => item.group === id).length])) as Record<DashboardGroup, number>, [visible])
  const recentThreshold = Date.now() - 7 * 86_400_000

  return <section className="hiveory-global-dashboard" aria-labelledby="hiveory-global-dashboard-title">
    <header className="hiveory-global-dashboard-header">
      <div><h1 id="hiveory-global-dashboard-title">Dashboard</h1><p>Your work across Code, Agent, Chat, and Automations.</p></div>
      <button type="button" className="hiveory-icon-button" onClick={() => void refresh()} aria-label="Refresh dashboard" title="Refresh dashboard"><RefreshCw size={16} className={loading ? 'is-spinning' : ''} /></button>
    </header>
    <div className="hiveory-global-dashboard-summary">{groupMeta.map(({ id, title }) => <div key={id}><span>{title}</span><strong>{counts[id]}</strong></div>)}</div>
    <div className="hiveory-global-dashboard-controls">
      <div role="tablist" aria-label="Dashboard sources">{(['all', 'code', 'agent', 'chat', 'automation'] as const).map((source) => <button type="button" key={source} className={filter === source ? 'is-selected' : ''} onClick={() => setFilter(source)}>{source === 'all' ? 'All' : sourceLabel[source]}</button>)}</div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search work" aria-label="Search dashboard" />
    </div>
    {errors.length > 0 && <div className="hiveory-feedback" role="status">{errors.join(' ')}</div>}
    <div className="hiveory-global-dashboard-groups">{groupMeta.map(({ id, title, empty }) => {
      const groupItems = visible.filter((item) => item.group === id && (id !== 'recent' || item.updatedAt >= recentThreshold)).sort((left, right) => right.updatedAt - left.updatedAt)
      const displayed = groupItems.slice(0, id === 'recent' ? 20 : 8)
      return <section key={id} className="hiveory-dashboard-group"><header><h2>{id === 'attention' ? <AlertTriangle size={16} /> : id === 'working' ? <Activity size={16} /> : id === 'waiting' ? <CalendarClock size={16} /> : <CheckCircle2 size={16} />}{title}<span>{groupItems.length}</span></h2></header>{displayed.length ? <div>{displayed.map((item) => <button type="button" className="hiveory-dashboard-card" key={item.id} onClick={() => onOpenSource(item)}><span className={`hiveory-dashboard-source is-${item.source}`}>{sourceLabel[item.source] === 'Chat' ? <MessageSquare size={12} /> : sourceLabel[item.source]}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span><span className="hiveory-dashboard-card-meta"><b>{item.state}</b><time>{relativeTime(item.updatedAt)}</time></span><ChevronRight size={15} /></button>)}</div> : <p>{loading ? 'Loading…' : empty}</p>}{groupItems.length > displayed.length && <span className="hiveory-dashboard-more">{groupItems.length - displayed.length} more items available through the source filter.</span>}</section>
    })}</div>
  </section>
}
