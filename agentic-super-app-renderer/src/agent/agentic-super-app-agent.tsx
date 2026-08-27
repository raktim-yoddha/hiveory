import { Bot, BrainCircuit, Check, ChevronRight, CircleDot, Gauge, KeyRound, Library, MessageSquare, Plus, RefreshCw, ShieldAlert, Sparkles, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { agenticSuperAppClient, type AgentApprovalSummary, type AgentDashboard, type AgentDetail, type AgentEventEnvelope, type AgentMemorySummary, type AgentRunDetail, type AgentRunSummary } from '../api/agentic-super-app-client'

type AgentPanel = 'overview' | 'runs' | 'skills' | 'memory'

const stateLabels: Record<string, string> = {
  queued: 'Queued', preparing: 'Preparing', running: 'Running', awaiting_approval: 'Approval needed', awaiting_input: 'Waiting for you', interrupted: 'Interrupted', completed: 'Completed', failed: 'Failed', cancelled: 'Cancelled',
}

export function AgenticSuperAppAgent({ initialPanel = 'overview' }: { initialPanel?: AgentPanel }) {
  const [dashboard, setDashboard] = useState<AgentDashboard | null>(null)
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [panel, setPanel] = useState<AgentPanel>('overview')
  const [run, setRun] = useState<AgentRunDetail | null>(null)
  const [events, setEvents] = useState<AgentEventEnvelope[]>([])
  const [prompt, setPrompt] = useState('Give me a short orientation of what this Agent can do.')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => { setPanel(initialPanel) }, [initialPanel])

  const refresh = useCallback(async () => {
    try {
      const nextDashboard = await agenticSuperAppClient.agentDashboard()
      setDashboard(nextDashboard)
      const nextId = selectedAgentId ?? nextDashboard.agents[0]?.id
      if (nextId) {
        setSelectedAgentId(nextId)
        setDetail(await agenticSuperAppClient.agent(nextId))
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Agent data could not be loaded.')
    }
  }, [selectedAgentId])

  useEffect(() => { void refresh() }, [refresh, refreshKey])
  useEffect(() => {
    const runId = run?.summary.id
    if (!runId) return
    let active = true
    void agenticSuperAppClient.agentRun(runId).then((next) => { if (active) setRun(next) }).catch(() => undefined)
    const unsubscribe = agenticSuperAppClient.subscribeAgent(runId, (event) => {
      if (!active) return
      setEvents((current) => [...current, event].slice(-80))
      void agenticSuperAppClient.agentRun(runId).then((next) => { if (active) setRun(next) }).catch(() => undefined)
      if (event.kind === 'run_state_changed' || event.kind === 'tool_call_completed' || event.kind === 'approval_requested') void refresh()
    })
    return () => { active = false; unsubscribe() }
  }, [refresh, run?.summary.id])

  const activeRuns = dashboard?.active_runs ?? []
  const pendingApprovals = dashboard?.pending_approvals ?? []
  const selectedSummary = dashboard?.agents.find((agent) => agent.id === selectedAgentId) ?? dashboard?.agents[0]

  const startRun = async () => {
    if (!detail || !prompt.trim()) return
    setBusy(true); setFeedback(null)
    try {
      const next = await agenticSuperAppClient.startAgentRun({ agent_id: detail.summary.id, conversation_id: null, prompt: prompt.trim(), background: false })
      setRun({ summary: next, messages: [], tool_calls: [], approvals: [], skills: detail.skills.filter((skill) => skill.enabled), memories: [], artifacts: [], child_runs: [], event_cursor: 0 })
      setPanel('overview')
      setFeedback('Run started. Events are retained locally as they arrive.')
      await refresh()
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'The Agent run could not be started.') } finally { setBusy(false) }
  }

  const selectRun = async (summary: AgentRunSummary) => {
    setBusy(true)
    try { setRun(await agenticSuperAppClient.agentRun(summary.id)); setPanel('overview'); setFeedback(null) } catch (error) { setFeedback(error instanceof Error ? error.message : 'Run details could not be loaded.') } finally { setBusy(false) }
  }

  const createAgent = async (request: { name: string; model: string }) => {
    setBusy(true)
    try {
      const created = await agenticSuperAppClient.createAgent({ name: request.name, description: 'A local-first assistant with explicit permissions.', operating_brief: 'Work only inside folders explicitly granted by the user. Ask before mutations.', avatar_color: '#22d3ee', provider_account_id: 'agentic-super-app-openai', model: request.model, system_instructions: 'Be concise, inspectable, and cautious with side effects.', approval_policy: 'ask_for_mutations', memory_policy: 'explicit_only', runtime_limits: { max_steps: 24, max_tool_calls: 32, max_duration_seconds: 1800, max_context_tokens: 128000, max_subagent_depth: 2, max_concurrent_subagents: 2 } })
      setSelectedAgentId(created.summary.id); setDetail(created); setShowCreate(false); setFeedback(`${created.summary.name} is ready.`); setRefreshKey((value) => value + 1)
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'The Agent could not be created.') } finally { setBusy(false) }
  }

  return <section className="agentic-super-app-agent" aria-labelledby="agentic-super-app-agent-title">
    <div className="agentic-super-app-content-header agentic-super-app-agent-header">
      <div className="agentic-super-app-agent-heading-mark"><Bot size={22} aria-hidden="true" /></div>
      <div><p className="agentic-super-app-eyebrow">Agent workspace</p><h1 id="agentic-super-app-agent-title">Operate with clear boundaries</h1></div>
      <div className="agentic-super-app-agent-header-actions"><span className="agentic-super-app-local-badge"><CircleDot size={12} />Local-first</span><button className="agentic-super-app-icon-button" onClick={() => setRefreshKey((value) => value + 1)} aria-label="Refresh Agent workspace"><RefreshCw size={16} /></button></div>
    </div>
    <p className="agentic-super-app-description">Named assistants, durable runs, explicit tools, inspectable memory, and approvals that pause before side effects.</p>
    <div className="agentic-super-app-agent-layout">
      <aside className="agentic-super-app-agent-list" aria-label="Named Agents">
        <div className="agentic-super-app-section-label">Named Agents <span>{dashboard?.agents.length ?? 0}</span></div>
        {(dashboard?.agents ?? []).map((agent) => <button key={agent.id} className={`agentic-super-app-agent-list-item ${agent.id === selectedAgentId ? 'is-selected' : ''}`} onClick={() => { setSelectedAgentId(agent.id); setPanel('overview'); setRun(null); setFeedback(null) }}><span className="agentic-super-app-agent-avatar" style={{ background: agent.avatar_color }}>{agent.name.slice(0, 1).toUpperCase()}</span><span className="agentic-super-app-agent-list-copy"><strong>{agent.name}</strong><small>{agent.active_run_state ? stateLabels[agent.active_run_state] : 'Ready'}</small></span><ChevronRight size={15} aria-hidden="true" /></button>)}
        <button className="agentic-super-app-add-agent" onClick={() => setShowCreate(true)}><Plus size={15} />New Agent</button>
        <div className="agentic-super-app-agent-list-footer"><span>Runtime</span><strong>{activeRuns.length} active</strong><span>Pending approvals</span><strong>{pendingApprovals.length}</strong></div>
      </aside>
      <div className="agentic-super-app-agent-main">
        {!detail || !selectedSummary ? <div className="agentic-super-app-agent-onboarding"><Sparkles size={26} /><h2>Start your first Agent</h2><p>Create a named assistant with a model, operating brief, and approval policy.</p><button onClick={() => setShowCreate(true)}><Plus size={15} />Create Agent</button></div> : <>
          <div className="agentic-super-app-agent-tabs" role="tablist" aria-label="Agent sections">{([['overview', 'Workspace', MessageSquare], ['runs', 'Runs', Gauge], ['skills', 'Skills', Sparkles], ['memory', 'Memory', BrainCircuit]] as const).map(([id, label, Icon]) => <button key={id} role="tab" aria-selected={panel === id} className={panel === id ? 'is-active' : ''} onClick={() => setPanel(id)}><Icon size={15} />{label}{id === 'runs' && activeRuns.length > 0 && <span>{activeRuns.length}</span>}</button>)}</div>
          {panel === 'overview' && <AgentWorkspace detail={detail} run={run} events={events} prompt={prompt} setPrompt={setPrompt} busy={busy} startRun={startRun} feedback={feedback} />}
          {panel === 'runs' && <AgentRuns runs={dashboard?.recent_runs ?? []} activeRunId={run?.summary.id ?? null} onSelect={selectRun} busy={busy} />}
          {panel === 'skills' && <AgentSkills detail={detail} onToggle={async (skillId, enabled) => { setBusy(true); try { setDetail(await agenticSuperAppClient.toggleAgentSkill({ agent_id: detail.summary.id, skill_id: skillId, enabled })) } catch (error) { setFeedback(error instanceof Error ? error.message : 'Skill setting could not be changed.') } finally { setBusy(false) } }} />}
          {panel === 'memory' && <AgentMemory detail={detail} />}
        </>}
      </div>
    </div>
    {showCreate && <CreateAgentDialog busy={busy} onCancel={() => setShowCreate(false)} onCreate={createAgent} />}
  </section>
}

function AgentWorkspace({ detail, run, events, prompt, setPrompt, busy, startRun, feedback }: { detail: AgentDetail; run: AgentRunDetail | null; events: AgentEventEnvelope[]; prompt: string; setPrompt: (value: string) => void; busy: boolean; startRun: () => void; feedback: string | null }) {
  const visibleMessages = run?.messages ?? []
  const pendingApproval = run?.approvals.find((approval) => approval.state === 'pending')
  const inputEvent = [...events].reverse().find((event) => event.kind === 'input_requested')
  return <div className="agentic-super-app-agent-workspace">
    <div className="agentic-super-app-agent-context-card"><div className="agentic-super-app-agent-avatar large" style={{ background: detail.summary.avatar_color }}>{detail.summary.name.slice(0, 1).toUpperCase()}</div><div><h2>{detail.summary.name}</h2><p>{detail.summary.description}</p></div><span className="agentic-super-app-state-chip ready"><CircleDot size={11} />{run ? stateLabels[run.summary.state] : 'Ready'}</span></div>
    {pendingApproval && <ApprovalCard approval={pendingApproval} onResolved={() => undefined} />}
    {inputEvent && run?.summary.state === 'awaiting_input' && <InputCard event={inputEvent} runId={run.summary.id} />}
    <div className="agentic-super-app-agent-transcript" aria-live="polite">{visibleMessages.length ? visibleMessages.map((message) => <article key={message.id} className={`agentic-super-app-agent-message ${message.role}`}><span className="agentic-super-app-message-role">{message.role === 'user' ? 'You' : message.role === 'assistant' ? detail.summary.name : 'System'}</span><p>{message.content}</p></article>) : <div className="agentic-super-app-agent-welcome"><Sparkles size={18} /><p>Ask for research, a folder brief, an artifact, or a bounded follow-up. The Agent will show each tool and pause before mutations.</p></div>}</div>
    <div className="agentic-super-app-agent-composer"><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); startRun() } }} rows={3} placeholder="Tell the Agent what to do…" aria-label="Agent prompt" /><div className="agentic-super-app-composer-footer"><span><KeyRound size={13} />Ctrl/⌘ + Enter to run</span><button onClick={startRun} disabled={busy || !prompt.trim()}>{busy ? <RefreshCw size={15} className="agentic-super-app-spin" /> : <Sparkles size={15} />}{busy ? 'Starting…' : 'Run Agent'}</button></div></div>
    {feedback && <div className="agentic-super-app-feedback" role="status">{feedback}</div>}
    <div className="agentic-super-app-agent-policy-strip"><ShieldAlert size={14} /><span>Policy: <strong>{detail.approval_policy.replaceAll('_', ' ')}</strong></span><span>•</span><span>{detail.folders.length} folder grants</span><span>•</span><span>{detail.tools.length} tools enabled</span></div>
  </div>
}

function ApprovalCard({ approval, onResolved }: { approval: AgentApprovalSummary; onResolved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const resolve = async (decision: 'approve' | 'deny') => { setBusy(true); setMessage(null); try { await agenticSuperAppClient.decideAgentApproval({ run_id: approval.run_id, approval_id: approval.id, fingerprint: approval.fingerprint, decision, comment: null }); onResolved() } catch (error) { setMessage(error instanceof Error ? error.message : 'Approval could not be resolved.') } finally { setBusy(false) } }
  return <section className="agentic-super-app-approval-card" aria-label="Agent approval required"><div className="agentic-super-app-approval-icon"><ShieldAlert size={19} /></div><div className="agentic-super-app-approval-copy"><div className="agentic-super-app-card-heading"><h3>Approval required</h3><span>{approval.reversible ? 'Reversible' : 'Side effect'}</span></div><p><strong>{approval.tool_name}</strong> wants to act on <code>{approval.target}</code>.</p><details><summary>Inspect arguments</summary><pre>{approval.arguments_json}</pre></details>{message && <small role="alert">{message}</small>}<div className="agentic-super-app-inline-actions"><button disabled={busy} onClick={() => resolve('approve')}><Check size={14} />Approve once</button><button className="is-secondary" disabled={busy} onClick={() => resolve('deny')}><X size={14} />Deny</button></div></div></section>
}

function InputCard({ event, runId }: { event: AgentEventEnvelope; runId: string }) {
  const [answer, setAnswer] = useState(''); const [busy, setBusy] = useState(false); const prompt = useMemo(() => { try { return JSON.parse(event.payload).prompt ?? 'The Agent needs more information.' } catch { return 'The Agent needs more information.' } }, [event.payload])
  const submit = async () => { if (!answer.trim()) return; setBusy(true); try { await agenticSuperAppClient.submitAgentInput({ run_id: runId, answer: answer.trim() }) } finally { setBusy(false) } }
  return <section className="agentic-super-app-input-card"><div><MessageSquare size={17} /><strong>{prompt}</strong></div><div className="agentic-super-app-inline-form"><input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Your answer" aria-label="Answer for Agent" /><button disabled={busy || !answer.trim()} onClick={submit}>Send</button></div></section>
}

function AgentRuns({ runs, activeRunId, onSelect, busy }: { runs: AgentRunSummary[]; activeRunId: string | null; onSelect: (run: AgentRunSummary) => void; busy: boolean }) {
  return <div className="agentic-super-app-agent-panel"><div className="agentic-super-app-panel-heading"><div><p className="agentic-super-app-eyebrow">Durable activity</p><h2>Runs</h2></div><span>{runs.length} retained</span></div><div className="agentic-super-app-run-list">{runs.length ? runs.map((run) => <button key={run.id} className={`agentic-super-app-run-row ${run.id === activeRunId ? 'is-selected' : ''}`} onClick={() => onSelect(run)} disabled={busy}><span className={`agentic-super-app-state-dot ${run.state}`} /><span className="agentic-super-app-run-copy"><strong>{run.prompt_preview || 'Untitled run'}</strong><small>{stateLabels[run.state]} · {run.tool_call_count} tool calls · step {run.step_count}</small></span><time>{new Date(run.updated_at_unix_ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><ChevronRight size={15} /></button>) : <div className="agentic-super-app-empty-panel"><Gauge size={22} /><p>No runs yet. Start a workspace turn to create durable activity.</p></div>}</div></div>
}

function AgentSkills({ detail, onToggle }: { detail: AgentDetail; onToggle: (skillId: string, enabled: boolean) => void }) {
  return <div className="agentic-super-app-agent-panel"><div className="agentic-super-app-panel-heading"><div><p className="agentic-super-app-eyebrow">Reusable instructions</p><h2>Skills</h2></div><span>{detail.skills.filter((skill) => skill.enabled).length} enabled</span></div><div className="agentic-super-app-skill-grid">{detail.skills.map((skill) => <article key={skill.id} className={`agentic-super-app-skill-card ${skill.enabled ? 'is-enabled' : ''}`}><div className="agentic-super-app-skill-card-top"><div className="agentic-super-app-skill-icon"><Sparkles size={16} /></div><label className="agentic-super-app-switch"><input type="checkbox" checked={skill.enabled} onChange={(event) => onToggle(skill.id, event.target.checked)} /><span /></label></div><h3>{skill.name}</h3><p>{skill.description}</p><div className="agentic-super-app-tag-row">{skill.triggers.slice(0, 3).map((trigger) => <span key={trigger}>{trigger}</span>)}</div><small>{skill.origin} · v{skill.version}</small></article>)}</div></div>
}

function AgentMemory({ detail }: { detail: AgentDetail }) {
  const [memory, setMemory] = useState<AgentMemorySummary[]>([]); const [loading, setLoading] = useState(true)
  useEffect(() => { let active = true; void agenticSuperAppClient.agentMemory({ agent_id: detail.summary.id, search: null, class: null, limit: 100 }).then((items) => { if (active) setMemory(items) }).finally(() => { if (active) setLoading(false) }); return () => { active = false } }, [detail.summary.id])
  return <div className="agentic-super-app-agent-panel"><div className="agentic-super-app-panel-heading"><div><p className="agentic-super-app-eyebrow">Inspectable context</p><h2>Memory</h2></div><span>Policy: {detail.memory_policy.replaceAll('_', ' ')}</span></div><div className="agentic-super-app-memory-notice"><BrainCircuit size={16} /><p>Memory is explicit and removable. Retrieved items are recorded in the run timeline.</p></div>{loading ? <div className="agentic-super-app-empty-panel"><RefreshCw size={18} className="agentic-super-app-spin" /><p>Loading memory…</p></div> : memory.length ? <div className="agentic-super-app-memory-list">{memory.map((item) => <article key={item.id}><div><span className="agentic-super-app-memory-class">{item.class.replaceAll('_', ' ')}</span><p>{item.content}</p></div><button className="agentic-super-app-icon-button" aria-label={`Delete memory ${item.id}`} onClick={() => void agenticSuperAppClient.deleteAgentMemory({ agent_id: item.agent_id, memory_id: item.id }).then(() => setMemory((current) => current.filter((candidate) => candidate.id !== item.id)))}><Trash2 size={15} /></button></article>)}</div> : <div className="agentic-super-app-empty-panel"><Library size={22} /><p>No durable memories yet. The Agent will only store explicit, non-sensitive memories.</p></div>}</div>
}

function CreateAgentDialog({ busy, onCancel, onCreate }: { busy: boolean; onCancel: () => void; onCreate: (request: { name: string; model: string }) => void }) {
  const [name, setName] = useState('Research companion'); const [model, setModel] = useState('gpt-5.6-mini')
  return <div className="agentic-super-app-modal-backdrop" role="presentation"><section className="agentic-super-app-modal" role="dialog" aria-modal="true" aria-labelledby="agentic-super-app-create-title"><div className="agentic-super-app-modal-heading"><div><p className="agentic-super-app-eyebrow">Named Agent</p><h2 id="agentic-super-app-create-title">Create an assistant</h2></div><button className="agentic-super-app-icon-button" onClick={onCancel} aria-label="Close create Agent dialog"><X size={17} /></button></div><p>Start with a bounded local profile. Folder grants and mutations remain explicit.</p><label htmlFor="agent-name">Name</label><input id="agent-name" value={name} onChange={(event) => setName(event.target.value)} autoFocus /><label htmlFor="agent-model">Model</label><input id="agent-model" value={model} onChange={(event) => setModel(event.target.value)} /><div className="agentic-super-app-modal-actions"><button className="is-secondary" onClick={onCancel}>Cancel</button><button disabled={busy || !name.trim() || !model.trim()} onClick={() => onCreate({ name: name.trim(), model: model.trim() })}><Plus size={15} />{busy ? 'Creating…' : 'Create Agent'}</button></div></section></div>
}

export default AgenticSuperAppAgent
