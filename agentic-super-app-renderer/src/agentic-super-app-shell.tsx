import { Activity, Bell, Bot, Code2, KeyRound, MessageSquare, PanelLeft, Play, RotateCcw, Settings2, ShieldCheck, Square, Wifi } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { agenticSuperAppClient, type ApplicationMode, type DiagnosticSnapshot, type SharedEventEnvelope } from './api/agentic-super-app-client'
import { AgenticSuperAppChat } from './chat/agentic-super-app-chat'
import { AgenticSuperAppCode } from './code/agentic-super-app-code'
import { AgenticSuperAppCodeRuns } from './code/agentic-super-app-code-runs'

type ModeDefinition = { mode: ApplicationMode; label: string; description: string; icon: typeof Bot; navigation: string[] }
const modes: ModeDefinition[] = [
  { mode: 'agent', label: 'Agent', description: 'Autonomous workspaces, reviews, and approvals will appear here.', icon: Bot, navigation: ['Runs', 'Profiles', 'Skills'] },
  { mode: 'code', label: 'Code', description: 'Projects, worker lanes, checkpoints, and reviewable runs live here.', icon: Code2, navigation: ['Workbench', 'Runs'] },
  { mode: 'chat', label: 'Chat', description: 'Focused conversations and artifacts will appear here.', icon: MessageSquare, navigation: ['Conversations', 'Artifacts', 'Archive'] },
]
const previewSnapshot: DiagnosticSnapshot = { providers: [], recent_jobs: [], notifications: [], recovery_message: null }

export function AgenticSuperAppShell() {
  const [activeMode, setActiveMode] = useState<ApplicationMode>('agent')
  const [codeScreen, setCodeScreen] = useState<'workbench' | 'runs'>('workbench')
  const [screen, setScreen] = useState<'workspace' | 'diagnostics'>('workspace')
  const [connected, setConnected] = useState(false)
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot>(previewSnapshot)
  const [events, setEvents] = useState<SharedEventEnvelope[]>([])
  const definition = useMemo(() => modes.find((item) => item.mode === activeMode)!, [activeMode])
  const refresh = () => void agenticSuperAppClient.diagnostics().then(setSnapshot).catch(() => undefined)

  useEffect(() => { void agenticSuperAppClient.bootstrap().then((item) => { setActiveMode(item.active_mode); setConnected(true) }).catch(() => setConnected(false)); refresh(); agenticSuperAppClient.subscribe((event) => { setEvents((items) => [event, ...items].slice(0, 30)); refresh() }) }, [])
  const selectMode = (mode: ApplicationMode) => { setScreen('workspace'); if (mode === 'code') setCodeScreen('workbench'); setActiveMode(mode); void agenticSuperAppClient.setActiveMode(mode).then((item) => setActiveMode(item.active_mode)).catch(() => undefined) }
  const ModeIcon = definition.icon
  return <main className="agentic-super-app-shell">
    <header className="agentic-super-app-titlebar">
      <div className="agentic-super-app-brand"><PanelLeft size={16} aria-hidden="true" /><span>Agentic Super App</span></div>
      <nav className="agentic-super-app-mode-switch" aria-label="Workspace mode">{modes.map(({ mode, label, icon: Icon }) => <button key={mode} className={mode === activeMode && screen === 'workspace' ? 'is-active' : ''} onClick={() => selectMode(mode)} aria-pressed={mode === activeMode && screen === 'workspace'}><Icon size={15} aria-hidden="true" />{label}</button>)}</nav>
      <div className="agentic-super-app-title-actions"><button className={screen === 'diagnostics' ? 'agentic-super-app-icon-button is-active' : 'agentic-super-app-icon-button'} onClick={() => { setScreen('diagnostics'); refresh() }} aria-label="Open diagnostics"><Activity size={16} /></button><div className="agentic-super-app-connection" aria-label={connected ? 'Connected to local host' : 'Preview mode'}><ShieldCheck size={15} aria-hidden="true" />{connected ? 'Local host' : 'Preview'}</div></div>
    </header>
    <section className={`agentic-super-app-workspace ${screen === 'workspace' && activeMode === 'chat' ? 'is-chat-mode' : ''} ${screen === 'workspace' && activeMode === 'code' ? 'is-code-mode' : ''}`}>
      <aside className="agentic-super-app-rail" aria-label={screen === 'diagnostics' ? 'Global navigation' : `${definition.label} navigation`}>
        {screen === 'diagnostics' ? <><div className="agentic-super-app-rail-heading">System</div><button className="is-selected"><Activity size={15} />Diagnostics</button><button onClick={() => setScreen('workspace')}><PanelLeft size={15} />Workspaces</button></> : <><div className="agentic-super-app-rail-heading">{definition.label}</div>{definition.navigation.map((item) => <button key={item} className={activeMode === 'code' && ((item === 'Runs' && codeScreen === 'runs') || (item === 'Workbench' && codeScreen === 'workbench')) ? 'is-selected' : ''} onClick={() => { if (activeMode === 'code') setCodeScreen(item === 'Runs' ? 'runs' : 'workbench') }}>{item}</button>)}</>}
        <div className="agentic-super-app-rail-footer">Phase 5 orchestration slice</div>
      </aside>
      {screen === 'diagnostics' ? <AgenticSuperAppDiagnostics snapshot={snapshot} events={events} refresh={refresh} /> : activeMode === 'chat' ? <AgenticSuperAppChat /> : activeMode === 'code' ? codeScreen === 'runs' ? <AgenticSuperAppCodeRuns /> : <AgenticSuperAppCode /> : <section className="agentic-super-app-content" aria-labelledby="agentic-super-app-page-title"><div className="agentic-super-app-content-header"><ModeIcon size={22} aria-hidden="true" /><div><p className="agentic-super-app-eyebrow">{definition.label} workspace</p><h1 id="agentic-super-app-page-title">Ready for the next layer</h1></div></div><p className="agentic-super-app-description">{definition.description}</p><div className="agentic-super-app-empty-state"><div className="agentic-super-app-empty-mark"><ModeIcon size={28} aria-hidden="true" /></div><h2>Shared foundation online</h2><p>Open Diagnostics to configure an opt-in provider test, inspect durable jobs, and verify recovery.</p></div></section>}
    </section>
  </main>
}

function AgenticSuperAppDiagnostics({ snapshot, events, refresh }: { snapshot: DiagnosticSnapshot; events: SharedEventEnvelope[]; refresh: () => void }) {
  const provider = snapshot.providers[0]
  const [model, setModel] = useState(provider?.default_model ?? '')
  const [secret, setSecret] = useState('')
  const [prompt, setPrompt] = useState('Reply with a concise confirmation that streaming is working.')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [activeJob, setActiveJob] = useState<string | null>(null)
  useEffect(() => { if (provider?.default_model) setModel(provider.default_model) }, [provider?.default_model])
  const run = async (name: string, action: () => Promise<void>) => { setBusy(name); setMessage(null); try { await action(); setMessage('Completed.'); refresh() } catch (error) { setMessage(error instanceof Error ? error.message : 'The action could not be completed.') } finally { setBusy(null) } }
  const start = async () => run('stream', async () => { if (!provider || !model.trim()) throw new Error('Enter a model ID before starting a billable test.'); const jobId = await agenticSuperAppClient.startDiagnostic({ providerAccountId: provider.id, model: model.trim(), prompt }); setActiveJob(jobId); setMessage('Streaming test started.'); refresh() })
  const nativePermission = async () => run('permission', async () => { if (!agenticSuperAppClient.isTauri) return; if (!await isPermissionGranted()) await requestPermission() })
  return <section className="agentic-super-app-diagnostics" aria-labelledby="agentic-super-app-diagnostics-title">
    <div className="agentic-super-app-content-header"><Settings2 size={22} aria-hidden="true" /><div><p className="agentic-super-app-eyebrow">Global utility</p><h1 id="agentic-super-app-diagnostics-title">Diagnostics</h1></div></div>
    <p className="agentic-super-app-description">Verify shared services before enabling product workflows. Provider requests are opt-in and use a model you explicitly select.</p>
    {snapshot.recovery_message && <div className="agentic-super-app-recovery" role="status"><RotateCcw size={16} />{snapshot.recovery_message}</div>}
    <div className="agentic-super-app-diagnostic-grid">
      <section className="agentic-super-app-diagnostic-card"><div className="agentic-super-app-card-heading"><KeyRound size={17} /><h2>OpenAI Responses</h2></div><label htmlFor="agentic-super-app-secret">API key</label><input id="agentic-super-app-secret" type="password" value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={provider?.secret_configured ? 'Stored securely' : 'Paste API key'} autoComplete="off" /><button disabled={busy !== null || !secret} onClick={() => run('secret', async () => { await agenticSuperAppClient.setSecret(secret); setSecret('') })}>{busy === 'secret' ? 'Storing…' : 'Store in credential manager'}</button><label htmlFor="agentic-super-app-model">Model ID</label><input id="agentic-super-app-model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="Choose a model ID" /><div className="agentic-super-app-inline-actions"><button disabled={busy !== null || !model.trim()} onClick={() => run('model', () => agenticSuperAppClient.configureModel(model.trim()))}>Save model</button><button className="is-secondary" disabled={busy !== null || !provider?.secret_configured} onClick={() => run('validate', () => agenticSuperAppClient.validateProvider())}>{busy === 'validate' ? 'Validating…' : 'Validate key'}</button></div></section>
      <section className="agentic-super-app-diagnostic-card"><div className="agentic-super-app-card-heading"><Wifi size={17} /><h2>Streaming test</h2></div><label htmlFor="agentic-super-app-prompt">Diagnostic prompt</label><textarea id="agentic-super-app-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} /><button disabled={busy !== null || !provider?.secret_configured || !model.trim()} onClick={start}><Play size={15} />{busy === 'stream' ? 'Starting…' : 'Start billable stream'}</button>{activeJob && <button className="is-danger" disabled={busy !== null} onClick={() => run('cancel', async () => { await agenticSuperAppClient.cancelJob(activeJob); setActiveJob(null) })}><Square size={14} />Cancel active stream</button>}<div className="agentic-super-app-live-log" aria-live="polite">{events.length ? events.map((event) => <p key={event.sequence}><span>{event.kind.replaceAll('_', ' ')}</span>{event.text_delta ?? event.message ?? 'Event received'}</p>) : <p>No live events yet.</p>}</div></section>
      <section className="agentic-super-app-diagnostic-card"><div className="agentic-super-app-card-heading"><Bell size={17} /><h2>Notifications and recovery</h2></div><p>Every notification is retained in-app. Native delivery needs your platform permission.</p><button className="is-secondary" disabled={busy !== null} onClick={nativePermission}>{busy === 'permission' ? 'Requesting…' : 'Request native permission'}</button><button disabled={busy !== null} onClick={() => run('notify', () => agenticSuperAppClient.testNotification())}>Send test notification</button><button className="is-secondary" disabled={busy !== null} onClick={() => run('restart', () => agenticSuperAppClient.restartRecovery())}><RotateCcw size={15} />Prepare recovery and restart</button></section>
      <section className="agentic-super-app-diagnostic-card"><div className="agentic-super-app-card-heading"><Activity size={17} /><h2>Durable state</h2></div><div className="agentic-super-app-status-list">{snapshot.recent_jobs.length ? snapshot.recent_jobs.map((job) => <div key={job.id}><span className={`agentic-super-app-state ${job.state}`}>{job.state}</span><code>{job.kind}</code></div>) : <p>No persisted jobs yet.</p>}</div><div className="agentic-super-app-status-list">{snapshot.notifications.length ? snapshot.notifications.slice(0, 3).map((item) => <div key={item.id}><span className="agentic-super-app-state completed">{item.severity}</span><span>{item.title}</span></div>) : <p>No notifications yet.</p>}</div></section>
    </div>
    {message && <div className="agentic-super-app-feedback" role="status">{message}</div>}
  </section>
}
