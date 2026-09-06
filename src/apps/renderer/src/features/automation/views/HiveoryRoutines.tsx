import { CheckCircle2, Edit3, History, Play, Plus, RefreshCw, Search, ShieldCheck, Trash2, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { hiveoryClient, type AgentFolderGrant, type AgentPluginGrant, type AgentSummary, type PluginCatalogEntry, type PluginConnectionSummary, type RoutineCreateRequest, type RoutineDetail, type RoutineExecution, type RoutineSummary, type RoutineUpdateRequest } from '../../../shared/api/hiveory-client'

const defaultRoutineRequest = (agentId: string): RoutineCreateRequest => ({
  name: 'Weekday repo audit',
  description: 'Check dependencies, failing tests, and risky open changes each weekday.',
  agent_id: agentId,
  prompt_template: 'Review repository health. Check dependencies, failing tests, lint and typecheck status, and risky open changes. Summarize the findings and recommend the next action.',
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

type AutomationTemplate = Pick<RoutineCreateRequest, 'name' | 'description' | 'prompt_template' | 'schedule'>

const automationTemplates: AutomationTemplate[] = [
  { name: 'Weekday repo audit', description: 'Check dependencies, failing tests, and risky open changes each weekday.', prompt_template: 'Review repository health. Check dependencies, failing tests, lint and typecheck status, and risky open changes. Summarize the findings and recommend the next action.', schedule: { expression: '0 9 * * 1-5', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } },
  { name: 'Release readiness', description: 'Prepare a weekly release risk summary from the current project state.', prompt_template: 'Review the current project for release readiness. Report unresolved changes, failing validation, dependency risks, and the highest-priority release blockers.', schedule: { expression: '0 10 * * 5', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } },
  { name: 'Daily change review', description: 'Summarize recent work and flag correctness, UX, and test coverage risks.', prompt_template: 'Review the latest local project changes. Identify correctness risks, UX regressions, missing tests, and specific next actions. Keep the report concise and evidence-based.', schedule: { expression: '0 17 * * 1-5', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } },
  { name: 'Hourly queue check', description: 'Look for stuck local work, stale generated files, and failed validation.', prompt_template: 'Inspect active local work. Report stuck tasks, stale generated files, failed validation, and any action that needs operator attention.', schedule: { expression: '0 * * * *', timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } },
]

const executionLabels: Record<string, string> = { queued: 'Queued', running: 'Running', awaiting_approval: 'Approval needed', completed: 'Completed', failed: 'Failed', skipped: 'Skipped', interrupted: 'Interrupted', unknown_outcome: 'Unknown outcome' }

function formatTime(value: number | null) {
  if (value === null) return 'Not scheduled'
  return new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function scheduleLabel(routine: RoutineSummary) {
  return `${routine.schedule.expression} · ${routine.schedule.timezone}`
}

export function HiveoryRoutines() {
  const [routines, setRoutines] = useState<RoutineSummary[]>([])
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [selected, setSelected] = useState<RoutineDetail | null>(null)
  const [editing, setEditing] = useState<RoutineDetail | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [query, setQuery] = useState('')
  const [template, setTemplate] = useState<AutomationTemplate | null>(null)
  const [showDetail, setShowDetail] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const refresh = useCallback(async (selectId?: string) => {
    try {
      const [nextRoutines, nextAgents] = await Promise.all([
        hiveoryClient.routines({ enabled: null, include_archived: includeArchived, limit: 100 }),
        hiveoryClient.agents(),
      ])
      setRoutines(nextRoutines); setAgents(nextAgents)
      const nextId = selectId ?? selected?.summary.id ?? nextRoutines[0]?.id
      if (nextId) setSelected(await hiveoryClient.routine(nextId))
      else setSelected(null)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Automations could not be loaded.')
    }
  }, [includeArchived, selected?.summary.id])

  useEffect(() => { void refresh() }, [refresh])

  const visibleRoutines = routines.filter((routine) => {
    const needle = query.trim().toLocaleLowerCase()
    return !needle || [routine.name, routine.description, routine.agent_name, scheduleLabel(routine)]
      .some((value) => value.toLocaleLowerCase().includes(needle))
  })

  const runAction = async (key: string, action: () => Promise<void>, message: string) => {
    setBusy(key); setFeedback(null)
    try { await action(); setFeedback(message); await refresh(selected?.summary.id) } catch (error) { setFeedback(error instanceof Error ? error.message : 'The routine action could not be completed.') } finally { setBusy(null) }
  }

  const selectRoutine = async (routine: RoutineSummary) => {
    setBusy(`select-${routine.id}`)
    try { setSelected(await hiveoryClient.routine(routine.id)); setShowDetail(true) } catch (error) { setFeedback(error instanceof Error ? error.message : 'Routine details could not be loaded.') } finally { setBusy(null) }
  }

  const saveRoutine = async (request: RoutineCreateRequest | RoutineUpdateRequest) => {
    setBusy('save'); setFeedback(null)
    try {
      const detail = 'routine_id' in request ? await hiveoryClient.updateRoutine(request) : await hiveoryClient.createRoutine(request)
      setShowForm(false); setEditing(null); setTemplate(null); setSelected(detail); setShowDetail(true); setFeedback('Routine saved. Its next occurrence is now durable.'); await refresh(detail.summary.id)
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'The routine could not be saved.') } finally { setBusy(null) }
  }

  return <section className="hiveory-automation hiveory-automation-desktop" aria-labelledby="hiveory-routines-title">
    <header className="hiveory-automation-desktop-header">
      <h1 id="hiveory-routines-title">Automations</h1>
      <div className="hiveory-automation-desktop-controls">
        <label className="hiveory-automation-desktop-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search..." aria-label="Search automations" /></label>
        <label className="hiveory-automation-desktop-filter"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />Show archived</label>
        <button className="hiveory-icon-button" onClick={() => void refresh()} aria-label="Refresh automations"><RefreshCw size={16} /></button>
        <button onClick={() => { setEditing(null); setTemplate(null); setShowForm(true) }} disabled={!agents.length}><Plus size={15} />New automation</button>
      </div>
    </header>
    <section className="hiveory-automation-desktop-surface" aria-label="Local automations">
      {visibleRoutines.length > 0 && <div className="hiveory-automation-desktop-list">
        {visibleRoutines.map((routine) => <button key={routine.id} className="hiveory-automation-desktop-row" onClick={() => void selectRoutine(routine)} disabled={busy === `select-${routine.id}`}>
          <span className={`hiveory-state-dot ${routine.enabled ? 'running' : routine.archived ? 'interrupted' : 'queued'}`} />
          <span><strong>{routine.name}</strong><small>{routine.description || 'No description provided.'}</small></span>
          <span className="hiveory-automation-desktop-row-meta">{routine.enabled ? 'Enabled' : routine.archived ? 'Archived' : 'Paused'} · next {formatTime(routine.next_run_unix_ms)}</span>
        </button>)}
      </div>}
      {!visibleRoutines.length && <div className="hiveory-automation-desktop-empty">
        <strong>{routines.length ? 'No matching automations' : 'No automations across loaded hosts'}</strong>
        <span>{routines.length ? 'Change the search or filter to see configured schedules.' : 'Create a schedule or start from one of the local templates below.'}</span>
      </div>}
      {agents.length > 0 && <div className="hiveory-automation-desktop-templates" aria-labelledby="hiveory-template-title">
        <h2 id="hiveory-template-title">Start from a template</h2>
        {automationTemplates.map((item) => <button key={item.name} type="button" disabled={busy !== null} onClick={() => { setEditing(null); setTemplate(item); setShowForm(true) }}>
          <small>{item.schedule.expression}</small><strong>{item.name}</strong><span>{item.description}</span>
        </button>)}
      </div>}
    </section>
    {feedback && <div className="hiveory-feedback" role="status">{feedback}</div>}
    {showDetail && selected && <div className="hiveory-modal-backdrop" role="presentation"><RoutineDetailPanel detail={selected} busy={busy} onClose={() => setShowDetail(false)} onRun={() => void runAction(`run-${selected.summary.id}`, async () => { await hiveoryClient.runRoutineNow(selected.summary.id) }, 'Routine run queued.')} onEdit={() => { setEditing(selected); setShowDetail(false); setShowForm(true) }} onArchive={() => void runAction(`archive-${selected.summary.id}`, async () => { await hiveoryClient.archiveRoutine(selected.summary.id) }, 'Routine archived.')} /></div>}
    {showForm && <RoutineFormDialog agents={agents} initial={editing} template={template} busy={busy === 'save'} onCancel={() => { setShowForm(false); setEditing(null); setTemplate(null) }} onSave={saveRoutine} />}
  </section>
}

function RoutineDetailPanel({ detail, busy, onClose, onRun, onEdit, onArchive }: { detail: RoutineDetail; busy: string | null; onClose: () => void; onRun: () => void; onEdit: () => void; onArchive: () => void }) {
  return <section className="hiveory-automation-detail hiveory-routine-detail-modal" role="dialog" aria-modal="true" aria-labelledby="hiveory-routine-detail-title">
    <div className="hiveory-panel-heading"><div><p className="hiveory-eyebrow">Routine detail</p><h2 id="hiveory-routine-detail-title">{detail.summary.name}</h2></div><div className="hiveory-inline-actions"><button className="is-secondary" onClick={onEdit} disabled={busy !== null}><Edit3 size={14} />Edit</button><button onClick={onRun} disabled={busy !== null || detail.summary.archived}><Play size={14} />{busy?.startsWith('run-') ? 'Queueing…' : 'Run now'}</button><button className="hiveory-icon-button" onClick={onClose} aria-label="Close automation detail"><X size={16} /></button></div></div>
    <p className="hiveory-muted-copy">{detail.summary.description || 'No description provided.'}</p>
    <div className="hiveory-routine-detail-grid"><div><span>Schedule</span><strong>{scheduleLabel(detail.summary)}</strong></div><div><span>Next run</span><strong>{formatTime(detail.summary.next_run_unix_ms)}</strong></div><div><span>Catch-up</span><strong>{detail.summary.catch_up.replaceAll('_', ' ')}</strong></div><div><span>Concurrency</span><strong>{detail.summary.concurrency.replaceAll('_', ' ')}</strong></div><div><span>Delivery</span><strong>{detail.summary.delivery.replaceAll('_', ' ')}</strong></div><div><span>Limits</span><strong>{detail.max_tool_calls} tools · {detail.max_duration_seconds}s</strong></div></div>
    <div className="hiveory-routine-prompt"><div className="hiveory-card-heading"><ShieldCheck size={15} /><h3>Prompt snapshot</h3></div><pre>{detail.prompt_template}</pre></div>
    <div className="hiveory-routine-executions"><div className="hiveory-card-heading"><History size={15} /><h3>Recent executions</h3><span>{detail.executions.length}</span></div>{detail.executions.length ? detail.executions.slice(0, 8).map((execution) => <ExecutionRow key={execution.id} execution={execution} />) : <p className="hiveory-muted-copy">No executions yet. Manual runs and scheduled occurrences appear here.</p>}</div>
    {!detail.summary.archived && <button className="hiveory-danger-link" onClick={onArchive} disabled={busy !== null}><Trash2 size={14} />Archive routine</button>}
  </section>
}

function ExecutionRow({ execution }: { execution: RoutineExecution }) {
  return <div className="hiveory-execution-row"><span className={`hiveory-state-dot ${execution.state}`} /><span><strong>{executionLabels[execution.state]}</strong><small>{formatTime(execution.scheduled_for_unix_ms)} · {execution.occurrence_key.startsWith('manual:') ? 'manual run' : execution.occurrence_key}</small></span><span className="hiveory-execution-result">{execution.error ?? execution.report ?? 'No report'}</span></div>
}

function RoutineFormDialog({ agents, initial, template, busy, onCancel, onSave }: { agents: AgentSummary[]; initial: RoutineDetail | null; template: AutomationTemplate | null; busy: boolean; onCancel: () => void; onSave: (request: RoutineCreateRequest | RoutineUpdateRequest) => void }) {
  const seed = initial ? { name: initial.summary.name, description: initial.summary.description, agent_id: initial.summary.agent_id, prompt_template: initial.prompt_template, schedule: initial.summary.schedule, enabled: initial.summary.enabled, catch_up: initial.summary.catch_up, concurrency: initial.summary.concurrency, delivery: initial.summary.delivery, folder_grant_ids: initial.folder_grant_ids, plugin_tool_names: initial.plugin_tool_names, max_duration_seconds: initial.max_duration_seconds, max_tool_calls: initial.max_tool_calls, approval_timeout_seconds: initial.approval_timeout_seconds } : { ...defaultRoutineRequest(agents[0]?.id ?? ''), ...template }
  const [form, setForm] = useState(seed)
  const [folders, setFolders] = useState<AgentFolderGrant[]>([])
  const [plugins, setPlugins] = useState<PluginCatalogEntry[]>([])
  const [agentGrants, setAgentGrants] = useState<AgentPluginGrant[]>([])
  const [connections, setConnections] = useState<PluginConnectionSummary[]>([])
  const update = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((current) => ({ ...current, [key]: value }))
  useEffect(() => { void Promise.all([hiveoryClient.pluginCatalog(), hiveoryClient.pluginConnections(), form.agent_id ? hiveoryClient.agent(form.agent_id) : Promise.resolve(null), form.agent_id ? hiveoryClient.agentPluginGrants(form.agent_id) : Promise.resolve([])]).then(([catalog, nextConnections, agent, grants]) => { setPlugins(catalog.filter((plugin) => plugin.enabled)); setConnections(nextConnections); setFolders(agent?.folders ?? []); setAgentGrants(grants.filter((grant) => grant.enabled && nextConnections.some((connection) => connection.id === grant.connection_id && connection.validated_at_unix_ms))) }).catch(() => { setPlugins([]); setConnections([]); setFolders([]); setAgentGrants([]) }) }, [form.agent_id])
  const toggleList = (key: 'folder_grant_ids' | 'plugin_tool_names', value: string) => update(key, form[key].includes(value) ? form[key].filter((item) => item !== value) : [...form[key], value])
  const tools = plugins.flatMap((plugin) => {
    const grants = agentGrants.filter((grant) => grant.plugin_id === plugin.manifest.id)
    if (!grants.length) return []
    return plugin.manifest.tools.filter((tool) => grants.some((grant) => grant.tool_names.length === 0 || grant.tool_names.includes(tool.name) || grant.tool_names.includes(`plugin.${plugin.manifest.id}.${tool.name}`))).map((tool) => ({ id: `plugin.${plugin.manifest.id}.${tool.name}`, label: `${plugin.manifest.name} · ${tool.name}` }))
  })
  const submit = () => {
    const request = { ...form, max_duration_seconds: Math.max(1, Number(form.max_duration_seconds)), max_tool_calls: Math.max(1, Number(form.max_tool_calls)), approval_timeout_seconds: Math.max(1, Number(form.approval_timeout_seconds)) }
    onSave(initial ? { ...request, routine_id: initial.summary.id } : request)
  }
  return <div className="hiveory-modal-backdrop" role="presentation"><section className="hiveory-modal hiveory-routine-modal" role="dialog" aria-modal="true" aria-labelledby="hiveory-routine-form-title"><div className="hiveory-modal-heading"><div><p className="hiveory-eyebrow">Durable schedule</p><h2 id="hiveory-routine-form-title">{initial ? 'Edit automation' : 'Create automation'}</h2></div><button className="hiveory-icon-button" onClick={onCancel} aria-label="Close automation form"><X size={17} /></button></div><div className="hiveory-form-grid"><label>Name<input value={form.name} onChange={(event) => update('name', event.target.value)} autoFocus maxLength={120} /></label><label>Agent<select value={form.agent_id} onChange={(event) => update('agent_id', event.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><label className="is-wide">Description<input value={form.description} onChange={(event) => update('description', event.target.value)} maxLength={240} /></label><label className="is-wide">Prompt template<textarea value={form.prompt_template} onChange={(event) => update('prompt_template', event.target.value)} rows={4} maxLength={64 * 1024} /></label><label>Cron expression<input value={form.schedule.expression} onChange={(event) => update('schedule', { ...form.schedule, expression: event.target.value })} placeholder="0 9 * * 1-5" /><small>minute hour day month weekday</small></label><label>Timezone<input value={form.schedule.timezone} onChange={(event) => update('schedule', { ...form.schedule, timezone: event.target.value })} placeholder="Asia/Kolkata" /></label><label>Catch-up<select value={form.catch_up} onChange={(event) => update('catch_up', event.target.value as RoutineCreateRequest['catch_up'])}><option value="skip">Skip missed</option><option value="run_latest">Run latest</option><option value="run_all_bounded">Run all, bounded</option></select></label><label>Concurrency<select value={form.concurrency} onChange={(event) => update('concurrency', event.target.value as RoutineCreateRequest['concurrency'])}><option value="skip">Skip if active</option><option value="queue_one">Queue one</option><option value="parallel_bounded">Parallel, max 4</option></select></label><label>Delivery<select value={form.delivery} onChange={(event) => update('delivery', event.target.value as RoutineCreateRequest['delivery'])}><option value="in_app">In-app only</option><option value="in_app_and_native">In-app + native</option></select></label><label>Max tool calls<input type="number" min="1" max="200" value={form.max_tool_calls} onChange={(event) => update('max_tool_calls', Number(event.target.value))} /></label><label>Duration (seconds)<input type="number" min="1" max="86400" value={form.max_duration_seconds} onChange={(event) => update('max_duration_seconds', Number(event.target.value))} /></label><label>Approval timeout<input type="number" min="1" max="86400" value={form.approval_timeout_seconds} onChange={(event) => update('approval_timeout_seconds', Number(event.target.value))} /></label><div className="is-wide hiveory-automation-picker"><span>Workspace folders</span>{folders.length ? folders.map((folder) => <label key={folder.id} className="hiveory-checkbox"><input type="checkbox" checked={form.folder_grant_ids.includes(folder.id)} onChange={() => toggleList('folder_grant_ids', folder.id)} /><span>{folder.display_name}</span></label>) : <small>This Agent has no granted folders.</small>}</div><div className="is-wide hiveory-automation-picker"><span>Plugin tools</span>{tools.length ? tools.map((tool) => <label key={tool.id} className="hiveory-checkbox"><input type="checkbox" checked={form.plugin_tool_names.includes(tool.id)} onChange={() => toggleList('plugin_tool_names', tool.id)} /><span>{tool.label}</span></label>) : <small>{connections.length ? 'Test a plugin connection and grant it to this Agent before an automation can use its tools.' : 'Connect and test a plugin before an automation can use its tools.'}</small>}</div></div><label className="hiveory-checkbox"><input type="checkbox" checked={form.enabled} onChange={(event) => update('enabled', event.target.checked)} /><span>Enable schedule immediately</span></label><div className="hiveory-modal-actions"><button className="is-secondary" onClick={onCancel}>Cancel</button><button disabled={busy || !form.name.trim() || !form.agent_id || !form.prompt_template.trim() || !form.schedule.expression.trim() || !form.schedule.timezone.trim()} onClick={submit}><CheckCircle2 size={15} />{busy ? 'Saving…' : 'Save automation'}</button></div></section></div>
}

export default HiveoryRoutines
