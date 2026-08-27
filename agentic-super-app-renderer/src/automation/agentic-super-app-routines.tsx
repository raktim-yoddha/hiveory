import { CalendarClock, CheckCircle2, Clock3, Edit3, History, Play, Plus, RefreshCw, ShieldCheck, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { agenticSuperAppClient, type AgentSummary, type RoutineCreateRequest, type RoutineDetail, type RoutineExecution, type RoutineSummary, type RoutineUpdateRequest } from '../api/agentic-super-app-client'

const defaultRoutineRequest = (agentId: string): RoutineCreateRequest => ({
  name: 'Daily operator brief',
  description: 'A short, bounded briefing delivered to the local notification center.',
  agent_id: agentId,
  prompt_template: 'Summarize the most important updates for me in five bullets. Keep the result concise and cite any sources you used.',
  schedule: { expression: '0 9 * * 1-5', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
  enabled: true,
  catch_up: 'run_latest',
  concurrency: 'skip',
  delivery: 'in_app_and_native',
  folder_grant_ids: [],
  plugin_tool_names: [],
  max_duration_seconds: 600,
  max_tool_calls: 12,
  approval_timeout_seconds: 300,
})

const executionLabels: Record<string, string> = { queued: 'Queued', running: 'Running', awaiting_approval: 'Approval needed', completed: 'Completed', failed: 'Failed', skipped: 'Skipped', interrupted: 'Interrupted', unknown_outcome: 'Unknown outcome' }

function formatTime(value: number | null) {
  if (value === null) return 'Not scheduled'
  return new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function scheduleLabel(routine: RoutineSummary) {
  return `${routine.schedule.expression} · ${routine.schedule.timezone}`
}

export function AgenticSuperAppRoutines() {
  const [routines, setRoutines] = useState<RoutineSummary[]>([])
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [selected, setSelected] = useState<RoutineDetail | null>(null)
  const [editing, setEditing] = useState<RoutineDetail | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const refresh = useCallback(async (selectId?: string) => {
    try {
      const [nextRoutines, nextAgents] = await Promise.all([
        agenticSuperAppClient.routines({ enabled: null, include_archived: includeArchived, limit: 100 }),
        agenticSuperAppClient.agents(),
      ])
      setRoutines(nextRoutines); setAgents(nextAgents)
      const nextId = selectId ?? selected?.summary.id ?? nextRoutines[0]?.id
      if (nextId) setSelected(await agenticSuperAppClient.routine(nextId))
      else setSelected(null)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Routines could not be loaded.')
    }
  }, [includeArchived, selected?.summary.id])

  useEffect(() => { void refresh() }, [refresh])

  const activeCount = routines.filter((routine) => routine.enabled && !routine.archived).length
  const nextScheduled = routines.filter((routine) => routine.enabled && routine.next_run_unix_ms !== null).sort((a, b) => (a.next_run_unix_ms ?? Infinity) - (b.next_run_unix_ms ?? Infinity))[0]

  const runAction = async (key: string, action: () => Promise<void>, message: string) => {
    setBusy(key); setFeedback(null)
    try { await action(); setFeedback(message); await refresh(selected?.summary.id) } catch (error) { setFeedback(error instanceof Error ? error.message : 'The routine action could not be completed.') } finally { setBusy(null) }
  }

  const selectRoutine = async (routine: RoutineSummary) => {
    setBusy(`select-${routine.id}`)
    try { setSelected(await agenticSuperAppClient.routine(routine.id)) } catch (error) { setFeedback(error instanceof Error ? error.message : 'Routine details could not be loaded.') } finally { setBusy(null) }
  }

  const saveRoutine = async (request: RoutineCreateRequest | RoutineUpdateRequest) => {
    setBusy('save'); setFeedback(null)
    try {
      const detail = 'routine_id' in request ? await agenticSuperAppClient.updateRoutine(request) : await agenticSuperAppClient.createRoutine(request)
      setShowForm(false); setEditing(null); setSelected(detail); setFeedback('Routine saved. Its next occurrence is now durable.'); await refresh(detail.summary.id)
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'The routine could not be saved.') } finally { setBusy(null) }
  }

  return <section className="agentic-super-app-automation" aria-labelledby="agentic-super-app-routines-title">
    <div className="agentic-super-app-content-header agentic-super-app-automation-header">
      <div className="agentic-super-app-agent-heading-mark"><CalendarClock size={22} aria-hidden="true" /></div>
      <div><p className="agentic-super-app-eyebrow">Durable automation</p><h1 id="agentic-super-app-routines-title">Routines</h1></div>
      <div className="agentic-super-app-agent-header-actions"><span className="agentic-super-app-local-badge"><ShieldCheck size={12} />Local scheduler</span><button className="agentic-super-app-icon-button" onClick={() => void refresh()} aria-label="Refresh routines"><RefreshCw size={16} /></button><button onClick={() => { setEditing(null); setShowForm(true) }} disabled={!agents.length}><Plus size={15} />New routine</button></div>
    </div>
    <p className="agentic-super-app-description">Time-zone aware schedules that launch bounded Agent runs. Every occurrence, approval, and failure stays inspectable.</p>
    <div className="agentic-super-app-automation-stats" aria-label="Routine summary">
      <div><span>Enabled</span><strong>{activeCount}</strong><small>running schedules</small></div>
      <div><span>Next occurrence</span><strong>{nextScheduled ? formatTime(nextScheduled.next_run_unix_ms) : '—'}</strong><small>{nextScheduled ? nextScheduled.name : 'nothing queued'}</small></div>
      <div><span>Policy</span><strong>Bounded</strong><small>10 catch-up slots · 15 min requests</small></div>
    </div>
    <div className="agentic-super-app-automation-toolbar"><label className="agentic-super-app-checkbox"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /><span>Show archived</span></label><span className="agentic-super-app-toolbar-count">{routines.length} configured</span></div>
    <div className="agentic-super-app-automation-layout">
      <div className="agentic-super-app-routine-list" aria-label="Configured routines">
        {routines.length ? routines.map((routine) => <button key={routine.id} className={`agentic-super-app-routine-row ${selected?.summary.id === routine.id ? 'is-selected' : ''}`} onClick={() => void selectRoutine(routine)} disabled={busy === `select-${routine.id}`}>
          <span className={`agentic-super-app-state-dot ${routine.enabled ? 'running' : routine.archived ? 'interrupted' : 'queued'}`} />
          <span className="agentic-super-app-routine-row-copy"><strong>{routine.name}</strong><small>{routine.agent_name} · {scheduleLabel(routine)}</small><small>{routine.last_execution_state ? executionLabels[routine.last_execution_state] : 'No executions yet'} · next {formatTime(routine.next_run_unix_ms)}</small></span>
          <span className="agentic-super-app-routine-row-action">{routine.enabled ? 'Enabled' : routine.archived ? 'Archived' : 'Paused'}</span>
        </button>) : <div className="agentic-super-app-empty-panel"><CalendarClock size={24} /><p>No routines configured. Create one to put a bounded Agent run on a durable schedule.</p></div>}
      </div>
      {selected ? <RoutineDetailPanel detail={selected} busy={busy} onRun={() => void runAction(`run-${selected.summary.id}`, async () => { await agenticSuperAppClient.runRoutineNow(selected.summary.id) }, 'Routine run queued.')} onEdit={() => { setEditing(selected); setShowForm(true) }} onArchive={() => void runAction(`archive-${selected.summary.id}`, async () => { await agenticSuperAppClient.archiveRoutine(selected.summary.id) }, 'Routine archived.')} /> : <div className="agentic-super-app-automation-detail agentic-super-app-empty-panel"><Clock3 size={24} /><p>Select a routine to inspect its schedule and execution history.</p></div>}
    </div>
    {feedback && <div className="agentic-super-app-feedback" role="status">{feedback}</div>}
    {showForm && <RoutineFormDialog agents={agents} initial={editing} busy={busy === 'save'} onCancel={() => { setShowForm(false); setEditing(null) }} onSave={saveRoutine} />}
  </section>
}

function RoutineDetailPanel({ detail, busy, onRun, onEdit, onArchive }: { detail: RoutineDetail; busy: string | null; onRun: () => void; onEdit: () => void; onArchive: () => void }) {
  return <section className="agentic-super-app-automation-detail" aria-labelledby="agentic-super-app-routine-detail-title">
    <div className="agentic-super-app-panel-heading"><div><p className="agentic-super-app-eyebrow">Routine detail</p><h2 id="agentic-super-app-routine-detail-title">{detail.summary.name}</h2></div><div className="agentic-super-app-inline-actions"><button className="is-secondary" onClick={onEdit} disabled={busy !== null}><Edit3 size={14} />Edit</button><button onClick={onRun} disabled={busy !== null || detail.summary.archived}><Play size={14} />{busy?.startsWith('run-') ? 'Queueing…' : 'Run now'}</button></div></div>
    <p className="agentic-super-app-muted-copy">{detail.summary.description || 'No description provided.'}</p>
    <div className="agentic-super-app-routine-detail-grid"><div><span>Schedule</span><strong>{scheduleLabel(detail.summary)}</strong></div><div><span>Next run</span><strong>{formatTime(detail.summary.next_run_unix_ms)}</strong></div><div><span>Catch-up</span><strong>{detail.summary.catch_up.replaceAll('_', ' ')}</strong></div><div><span>Concurrency</span><strong>{detail.summary.concurrency.replaceAll('_', ' ')}</strong></div><div><span>Delivery</span><strong>{detail.summary.delivery.replaceAll('_', ' ')}</strong></div><div><span>Limits</span><strong>{detail.max_tool_calls} tools · {detail.max_duration_seconds}s</strong></div></div>
    <div className="agentic-super-app-routine-prompt"><div className="agentic-super-app-card-heading"><ShieldCheck size={15} /><h3>Prompt snapshot</h3></div><pre>{detail.prompt_template}</pre></div>
    <div className="agentic-super-app-routine-executions"><div className="agentic-super-app-card-heading"><History size={15} /><h3>Recent executions</h3><span>{detail.executions.length}</span></div>{detail.executions.length ? detail.executions.slice(0, 8).map((execution) => <ExecutionRow key={execution.id} execution={execution} />) : <p className="agentic-super-app-muted-copy">No executions yet. Manual runs and scheduled occurrences appear here.</p>}</div>
    {!detail.summary.archived && <button className="agentic-super-app-danger-link" onClick={onArchive} disabled={busy !== null}><Trash2 size={14} />Archive routine</button>}
  </section>
}

function ExecutionRow({ execution }: { execution: RoutineExecution }) {
  return <div className="agentic-super-app-execution-row"><span className={`agentic-super-app-state-dot ${execution.state}`} /><span><strong>{executionLabels[execution.state]}</strong><small>{formatTime(execution.scheduled_for_unix_ms)} · {execution.occurrence_key.startsWith('manual:') ? 'manual run' : execution.occurrence_key}</small></span><span className="agentic-super-app-execution-result">{execution.error ?? execution.report ?? 'No report'}</span></div>
}

function RoutineFormDialog({ agents, initial, busy, onCancel, onSave }: { agents: AgentSummary[]; initial: RoutineDetail | null; busy: boolean; onCancel: () => void; onSave: (request: RoutineCreateRequest | RoutineUpdateRequest) => void }) {
  const seed = initial ? { name: initial.summary.name, description: initial.summary.description, agent_id: initial.summary.agent_id, prompt_template: initial.prompt_template, schedule: initial.summary.schedule, enabled: initial.summary.enabled, catch_up: initial.summary.catch_up, concurrency: initial.summary.concurrency, delivery: initial.summary.delivery, folder_grant_ids: initial.folder_grant_ids, plugin_tool_names: initial.plugin_tool_names, max_duration_seconds: initial.max_duration_seconds, max_tool_calls: initial.max_tool_calls, approval_timeout_seconds: initial.approval_timeout_seconds } : defaultRoutineRequest(agents[0]?.id ?? '')
  const [form, setForm] = useState(seed)
  const [folderGrants, setFolderGrants] = useState(form.folder_grant_ids.join(', '))
  const [pluginTools, setPluginTools] = useState(form.plugin_tool_names.join(', '))
  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }))
  const submit = () => {
    const request = { ...form, folder_grant_ids: folderGrants.split(',').map((item) => item.trim()).filter(Boolean), plugin_tool_names: pluginTools.split(',').map((item) => item.trim()).filter(Boolean), max_duration_seconds: Math.max(1, Number(form.max_duration_seconds)), max_tool_calls: Math.max(1, Number(form.max_tool_calls)), approval_timeout_seconds: Math.max(1, Number(form.approval_timeout_seconds)) }
    onSave(initial ? { ...request, routine_id: initial.summary.id } : request)
  }
  return <div className="agentic-super-app-modal-backdrop" role="presentation"><section className="agentic-super-app-modal agentic-super-app-routine-modal" role="dialog" aria-modal="true" aria-labelledby="agentic-super-app-routine-form-title"><div className="agentic-super-app-modal-heading"><div><p className="agentic-super-app-eyebrow">Durable schedule</p><h2 id="agentic-super-app-routine-form-title">{initial ? 'Edit routine' : 'Create routine'}</h2></div><button className="agentic-super-app-icon-button" onClick={onCancel} aria-label="Close routine form"><X size={17} /></button></div><div className="agentic-super-app-form-grid"><label>Name<input value={form.name} onChange={(event) => update('name', event.target.value)} autoFocus maxLength={120} /></label><label>Agent<select value={form.agent_id} onChange={(event) => update('agent_id', event.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><label className="is-wide">Description<input value={form.description} onChange={(event) => update('description', event.target.value)} maxLength={240} /></label><label className="is-wide">Prompt template<textarea value={form.prompt_template} onChange={(event) => update('prompt_template', event.target.value)} rows={4} maxLength={64 * 1024} /></label><label>Cron expression<input value={form.schedule.expression} onChange={(event) => update('schedule', { ...form.schedule, expression: event.target.value })} placeholder="0 9 * * 1-5" /><small>minute hour day month weekday</small></label><label>Timezone<input value={form.schedule.timezone} onChange={(event) => update('schedule', { ...form.schedule, timezone: event.target.value })} placeholder="Asia/Kolkata" /></label><label>Catch-up<select value={form.catch_up} onChange={(event) => update('catch_up', event.target.value as RoutineCreateRequest['catch_up'])}><option value="skip">Skip missed</option><option value="run_latest">Run latest</option><option value="run_all_bounded">Run all, bounded</option></select></label><label>Concurrency<select value={form.concurrency} onChange={(event) => update('concurrency', event.target.value as RoutineCreateRequest['concurrency'])}><option value="skip">Skip if active</option><option value="queue_one">Queue one</option><option value="parallel_bounded">Parallel, max 4</option></select></label><label>Delivery<select value={form.delivery} onChange={(event) => update('delivery', event.target.value as RoutineCreateRequest['delivery'])}><option value="in_app">In-app only</option><option value="in_app_and_native">In-app + native</option></select></label><label>Max tool calls<input type="number" min="1" max="200" value={form.max_tool_calls} onChange={(event) => update('max_tool_calls', Number(event.target.value))} /></label><label>Duration (seconds)<input type="number" min="1" max="86400" value={form.max_duration_seconds} onChange={(event) => update('max_duration_seconds', Number(event.target.value))} /></label><label>Approval timeout<input type="number" min="1" max="86400" value={form.approval_timeout_seconds} onChange={(event) => update('approval_timeout_seconds', Number(event.target.value))} /></label><label className="is-wide">Folder grant IDs<input value={folderGrants} onChange={(event) => setFolderGrants(event.target.value)} placeholder="Optional, comma-separated" /><small>Only existing grants should be used.</small></label><label className="is-wide">Plugin tool names<input value={pluginTools} onChange={(event) => setPluginTools(event.target.value)} placeholder="plugin.web-json-reader.get_json" /><small>These names are snapshotted for each execution.</small></label></div><label className="agentic-super-app-checkbox"><input type="checkbox" checked={form.enabled} onChange={(event) => update('enabled', event.target.checked)} /><span>Enable schedule immediately</span></label><div className="agentic-super-app-modal-actions"><button className="is-secondary" onClick={onCancel}>Cancel</button><button disabled={busy || !form.name.trim() || !form.agent_id || !form.prompt_template.trim() || !form.schedule.expression.trim() || !form.schedule.timezone.trim()} onClick={submit}><CheckCircle2 size={15} />{busy ? 'Saving…' : 'Save routine'}</button></div></section></div>
}

export default AgenticSuperAppRoutines
