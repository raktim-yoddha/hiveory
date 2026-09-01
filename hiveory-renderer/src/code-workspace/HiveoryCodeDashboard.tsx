import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, RefreshCw, Share2 } from 'lucide-react'
import { hiveoryClient, type AgentRunSummary, type AgentSummary } from '../api/hiveory-client'

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

export const HiveoryCodeDashboard: React.FC = () => {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [runs, setRuns] = useState<AgentRunSummary[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const nextAgents = (await hiveoryClient.agents()).filter((agent) => !agent.archived)
      const perAgentRuns = await Promise.all(nextAgents.map((agent) => hiveoryClient.agentRuns({ agent_id: agent.id, state: null, limit: 8 })))
      setAgents(nextAgents)
      setRuns(perAgentRuns.flat().sort((left, right) => Number(right.updated_at_unix_ms) - Number(left.updated_at_unix_ms)).slice(0, 12))
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Dashboard could not be loaded.')
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  const working = agents.filter((agent) => agent.active_run_state).length
  const totalTokens = useMemo(() => runs.reduce((total, run) => total + Number(run.input_tokens ?? 0) + Number(run.output_tokens ?? 0), 0), [runs])
  const agentName = (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? 'Agent'
  const stats = [
    { label: 'Agents', value: String(agents.length), subtext: `${working} working now` },
    { label: 'Recent runs', value: String(runs.length), subtext: `${runs.filter((run) => run.state === 'awaiting_approval').length} need approval` },
    { label: 'Tokens', value: totalTokens.toLocaleString(), subtext: 'recent visible runs' },
  ]

  return <div className="code-page-container">
    <header className="code-page-header"><div><h1 className="code-page-title">Dashboard</h1><p className="code-page-subtitle">What is running, what finished, and where you are needed.</p></div><button type="button" className="hiveory-icon-button" onClick={() => void refresh()} aria-label="Refresh dashboard"><RefreshCw size={15} /></button></header>
    {error && <div className="hiveory-feedback" role="alert">{error}</div>}
    <section className="code-dashboard-stats-grid">{stats.map((stat) => <article key={stat.label} className="code-dashboard-stat-card"><span className="code-stat-label">{stat.label}</span><strong className="code-stat-value">{stat.value}</strong><small className="code-stat-subtext">{stat.subtext}</small></article>)}</section>
    <section className="code-rows-container">
      {runs.map((run) => <div key={run.id} className="code-activity-row"><div className="code-activity-left"><div className="code-activity-icon-box"><Share2 size={16} /></div><div className="code-activity-info"><span className="code-activity-title">{agentName(run.agent_id)}</span><span className="code-activity-desc">{run.state.replaceAll('_', ' ')} · {run.prompt_preview || 'Agent run'}</span></div></div><div className="code-activity-right">{run.state === 'running' ? <span className="code-live-dot"><Activity size={12} /></span> : null}<span>{relativeTime(Number(run.updated_at_unix_ms))}</span></div></div>)}
      {!runs.length && !error && <div className="hiveory-empty-panel"><Activity size={24} /><p>No agent activity yet. Start an Agent run to see its status here.</p></div>}
    </section>
  </div>
}
