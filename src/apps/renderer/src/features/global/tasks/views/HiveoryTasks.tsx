import { CircleAlert, ExternalLink, Filter, Github, LoaderCircle, Plus, RefreshCw, Settings2, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { hiveoryClient, type CodeWorkspaceSummary, type TaskSourceConnectRequest, type TaskSourceItem, type TaskSourceProvider, type TaskSourceSnapshot } from '../../../../shared/api/hiveory-client'
import { HiveoryButton, HiveoryEmptyState, HiveoryIconButton, HiveoryPageHeader, HiveorySearchField, HiveoryTabs } from '../../../../shared/ui/HiveoryDesign'
import '../../../modes/code/workspace/styles/workspace.css'

const providerName: Record<TaskSourceProvider, string> = { github: 'GitHub', jira: 'Jira', linear: 'Linear' }
const providerHint: Record<TaskSourceProvider, string> = { github: 'Uses the authenticated gh CLI for this workspace.', jira: 'Connect your Jira Cloud site with your account email and API token. The token stays in the OS keyring.', linear: 'Connect with a Linear personal API key. The key stays in the OS keyring.' }
const sourceKinds: TaskSourceProvider[] = ['github', 'jira', 'linear']
function formatTime(value: string | null) { return value ? new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—' }

export function HiveoryTasks({ onOpenWorkspace, onStartLocalWork }: { onOpenWorkspace: (workspaceId: string) => void; onStartLocalWork: () => void }) {
  const [workspaces, setWorkspaces] = useState<CodeWorkspaceSummary[]>([])
  const [workspaceId, setWorkspaceId] = useState('')
  const [snapshot, setSnapshot] = useState<TaskSourceSnapshot | null>(null)
  const [query, setQuery] = useState('')
  const [provider, setProvider] = useState<'all' | TaskSourceProvider>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [connector, setConnector] = useState<TaskSourceProvider | null>(null)
  const [busy, setBusy] = useState(false)
  const workspaceIdRef = useRef(workspaceId)
  const loadRequestRef = useRef(0)
  useEffect(() => { workspaceIdRef.current = workspaceId }, [workspaceId])
  const load = useCallback(async (requestedWorkspaceId?: string) => {
    const requestId = ++loadRequestRef.current
    if (requestedWorkspaceId) {
      workspaceIdRef.current = requestedWorkspaceId
      setWorkspaceId(requestedWorkspaceId)
    }
    setLoading(true); setError(null)
    try {
      const code = await hiveoryClient.codeSnapshot()
      const selected = requestedWorkspaceId || workspaceIdRef.current || code.active_workspace_id || code.workspaces[0]?.id || ''
      const nextSnapshot = selected ? await hiveoryClient.taskSources(selected) : null
      if (requestId !== loadRequestRef.current) return
      workspaceIdRef.current = selected
      setWorkspaces(code.workspaces)
      setWorkspaceId(selected)
      setSnapshot(nextSnapshot)
    } catch (cause) {
      if (requestId === loadRequestRef.current) setError(cause instanceof Error ? cause.message : 'Task sources could not be loaded.')
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])
  const visible = useMemo(() => { const term = query.trim().toLocaleLowerCase(); return (snapshot?.items ?? []).filter((item) => (provider === 'all' || item.provider === provider) && (!term || [item.identifier, item.title, item.status, item.assignee ?? '', item.project ?? ''].some((value) => value.toLocaleLowerCase().includes(term)))) }, [snapshot, provider, query])
  const connect = async (request: TaskSourceConnectRequest) => { setBusy(true); setError(null); try { await hiveoryClient.connectTaskSource(request); setConnector(null); await load(request.workspace_id) } catch (cause) { setError(cause instanceof Error ? cause.message : 'The source could not connect.') } finally { setBusy(false) } }
  const remove = async (sourceId: string) => { if (!workspaceId || !confirm('Remove this local task source?')) return; setBusy(true); try { await hiveoryClient.removeTaskSource(workspaceId, sourceId); await load(workspaceId) } catch (cause) { setError(cause instanceof Error ? cause.message : 'The source could not be removed.') } finally { setBusy(false) } }
  const configured = new Set((snapshot?.sources ?? []).filter((source) => source.provider !== 'github').map((source) => source.provider))
  return <section className="hiveory-page hiveory-tasks-page hiveory-task-sources" aria-labelledby="hiveory-tasks-title">
    <HiveoryPageHeader id="hiveory-tasks-title" title="Tasks" subtitle="Connected task sources for the selected local workspace." className="hiveory-tasks-header" actions={<div className="hiveory-task-header-actions"><select value={workspaceId} onChange={(event) => void load(event.target.value)} aria-label="Select workspace"><option value="">Select workspace</option>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.display_name}</option>)}</select><HiveoryIconButton type="button" onClick={() => void load(workspaceId)} disabled={loading} title="Refresh tasks" aria-label="Refresh tasks"><RefreshCw size={15} className={loading ? 'is-spinning' : ''} /></HiveoryIconButton></div>} />
    {!workspaceId && !loading ? <HiveoryEmptyState title="Open a workspace first" action={<HiveoryButton type="button" intent="primary" onClick={onStartLocalWork}>Open workspace</HiveoryButton>}><><Settings2 size={22} aria-hidden="true" />Task sources are scoped to a local workspace so GitHub, Jira, and Linear never bleed into another project.</></HiveoryEmptyState> : <>
      <div className="hiveory-task-source-strip">{sourceKinds.map((kind) => { const source = snapshot?.sources.find((item) => item.provider === kind); return <div key={kind} className="hiveory-task-source-chip"><span>{kind === 'github' ? <Github size={15} /> : providerName[kind].slice(0, 1)}</span><div><strong>{providerName[kind]}</strong><small>{source?.validated_at_unix_ms ? 'Connected' : source?.last_error ?? (kind === 'github' ? 'Local CLI' : 'Not connected')}</small></div>{kind !== 'github' && <button type="button" onClick={() => setConnector(kind)}>{configured.has(kind) ? <Settings2 size={14} /> : <Plus size={14} />}</button>}{source && kind !== 'github' && <button type="button" className="hiveory-task-source-remove" onClick={() => void remove(source.id)} disabled={busy} aria-label={`Remove ${providerName[kind]}`}><X size={13} /></button>}</div> })}</div>
      <HiveoryTabs label="Task providers" value={provider} onChange={setProvider} tabs={[{ value: 'all', label: 'All' }, ...sourceKinds.map((kind) => ({ value: kind, label: providerName[kind] }))]} />
      <div className="hiveory-tasks-toolbar"><label className="hiveory-tasks-filter"><Filter size={15} /><span>Open work</span></label><HiveorySearchField value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search tasks" placeholder="Search issues, pull requests, and projects" /></div>
      <div className="hiveory-tasks-table" role="region" aria-label="Tasks from connected sources"><div className="hiveory-tasks-columns"><span>ID</span><span>Title / context</span><span>Assignees</span><span>Status</span><span>Updated</span></div>{loading ? <div className="hiveory-tasks-empty"><LoaderCircle className="is-spinning" size={22} /><p>Refreshing selected sources…</p></div> : error ? <div className="hiveory-tasks-empty"><CircleAlert size={22} /><h2>Tasks could not load</h2><p>{error}</p><button type="button" onClick={() => void load(workspaceId)}>Try again</button></div> : visible.length ? <div className="hiveory-tasks-rows">{visible.map((item) => <TaskRow key={`${item.source_id}:${item.identifier}`} item={item} />)}</div> : <div className="hiveory-tasks-empty"><CircleAlert size={22} /><h2>No matching tasks</h2><p>{snapshot?.sources.some((source) => source.validated_at_unix_ms) ? 'Change the search or refresh a connected source.' : 'Connect Jira or Linear, or authenticate the local gh CLI for this workspace.'}</p></div>}</div>
      <button type="button" className="hiveory-task-open-workspace" onClick={() => onOpenWorkspace(workspaceId)}>Open workspace</button>
    </>}{connector && <TaskSourceDialog provider={connector} workspaceId={workspaceId} busy={busy} onCancel={() => setConnector(null)} onSave={connect} />}
  </section>
}

function TaskRow({ item }: { item: TaskSourceItem }) { const content = <><span><code>{item.identifier}</code></span><span><strong>{item.title}</strong><small>{providerName[item.provider]}{item.project ? ` · ${item.project}` : ''}</small></span><span>{item.assignee ?? '—'}</span><span className="hiveory-task-state">{item.status}</span><time>{formatTime(item.updated_at)}</time></>; return item.url ? <a className="hiveory-task-row" href={item.url} target="_blank" rel="noreferrer">{content}<ExternalLink size={13} /></a> : <div className="hiveory-task-row">{content}</div> }
function TaskSourceDialog({ provider, workspaceId, busy, onCancel, onSave }: { provider: TaskSourceProvider; workspaceId: string; busy: boolean; onCancel: () => void; onSave: (request: TaskSourceConnectRequest) => void }) { const [label, setLabel] = useState(providerName[provider]); const [endpoint, setEndpoint] = useState(provider === 'linear' ? 'https://api.linear.app' : ''); const [email, setEmail] = useState(''); const [token, setToken] = useState(''); return <div className="hiveory-modal-backdrop" role="presentation"><section className="hiveory-modal hiveory-task-source-modal" role="dialog" aria-modal="true" aria-labelledby="task-source-title"><div className="hiveory-modal-heading"><div><p className="hiveory-eyebrow">Local task source</p><h2 id="task-source-title">Connect {providerName[provider]}</h2></div><button className="hiveory-icon-button" onClick={onCancel} aria-label="Close"><X size={17} /></button></div><p>{providerHint[provider]}</p><label>Name<input value={label} onChange={(event) => setLabel(event.target.value)} autoFocus /></label><label>{provider === 'jira' ? 'Jira site URL' : 'Linear endpoint'}<input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder={provider === 'jira' ? 'https://your-team.atlassian.net' : 'https://api.linear.app'} /></label>{provider === 'jira' && <label>Account email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>}<label>{provider === 'jira' ? 'API token' : 'Personal API key'}<input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="off" /></label><div className="hiveory-modal-actions"><button className="is-secondary" onClick={onCancel}>Cancel</button><button disabled={busy || !label.trim() || !endpoint.trim() || !token.trim() || provider === 'jira' && !email.trim()} onClick={() => onSave({ workspace_id: workspaceId, provider, label: label.trim(), endpoint: endpoint.trim(), account_email: provider === 'jira' ? email.trim() : null, token })}>{busy ? 'Testing…' : 'Test and connect'}</button></div></section></div> }
