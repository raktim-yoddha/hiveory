import { Check, Eye, Globe2, KeyRound, Link2, LockKeyhole, PlugZap, Plus, RefreshCw, ShieldCheck, TestTube2, Trash2, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { hiveoryClient, type AgentPluginGrant, type AgentSummary, type PluginCatalogEntry, type PluginConnectionCreateRequest, type PluginConnectionSummary } from '../../shared/api/hiveory-client'

function riskLabel(value: string) { return value.replaceAll('_', ' ') }

export function HiveoryPlugins() {
  const [catalog, setCatalog] = useState<PluginCatalogEntry[]>([])
  const [connections, setConnections] = useState<PluginConnectionSummary[]>([])
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showConnection, setShowConnection] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [nextCatalog, nextConnections, nextAgents] = await Promise.all([hiveoryClient.pluginCatalog(), hiveoryClient.pluginConnections(), hiveoryClient.agents()])
      setCatalog(nextCatalog); setConnections(nextConnections); setAgents(nextAgents); setSelectedId((current) => current ?? nextCatalog[0]?.manifest.id ?? null)
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Plugin catalog could not be loaded.') }
  }, [])
  useEffect(() => { void refresh() }, [refresh])

  const selected = catalog.find((entry) => entry.manifest.id === selectedId) ?? catalog[0]
  const selectedConnections = connections.filter((connection) => connection.plugin_id === selected?.manifest.id)
  const enabledCount = catalog.filter((entry) => entry.enabled).length
  const action = async (key: string, work: () => Promise<void>, message: string) => { setBusy(key); setFeedback(null); try { await work(); setFeedback(message); await refresh() } catch (error) { setFeedback(error instanceof Error ? error.message : 'The plugin action could not be completed.') } finally { setBusy(null) } }

  return <section className="hiveory-automation" aria-labelledby="hiveory-plugins-title">
    <div className="hiveory-content-header hiveory-automation-header"><div className="hiveory-agent-heading-mark"><PlugZap size={22} aria-hidden="true" /></div><div><p className="hiveory-eyebrow">Declarative integrations</p><h1 id="hiveory-plugins-title">Plugins</h1></div><div className="hiveory-agent-header-actions"><span className="hiveory-local-badge"><LockKeyhole size={12} />Allow-listed only</span><button className="hiveory-icon-button" onClick={() => void refresh()} aria-label="Refresh plugins"><RefreshCw size={16} /></button></div></div>
    <p className="hiveory-description">Connect narrowly-scoped JSON tools to an Agent. Schemas are strict, origins are allow-listed, credentials stay in the OS keyring, and mutating calls support dry runs.</p>
    <div className="hiveory-automation-stats" aria-label="Plugin summary"><div><span>Available</span><strong>{catalog.length}</strong><small>verified manifests</small></div><div><span>Enabled</span><strong>{enabledCount}</strong><small>eligible for grants</small></div><div><span>Connections</span><strong>{connections.length}</strong><small>secrets never displayed</small></div></div>
    <div className="hiveory-plugin-layout"><div className="hiveory-plugin-list" aria-label="Plugin catalog">{catalog.map((entry) => <button key={entry.manifest.id} className={`hiveory-plugin-row ${entry.manifest.id === selected?.manifest.id ? 'is-selected' : ''}`} onClick={() => setSelectedId(entry.manifest.id)}><span className="hiveory-plugin-mark"><Globe2 size={16} /></span><span><strong>{entry.manifest.name}</strong><small>{entry.manifest.publisher} · v{entry.manifest.version}</small></span><span className={`hiveory-plugin-status ${entry.enabled ? 'is-enabled' : ''}`}>{entry.enabled ? 'Enabled' : 'Disabled'}</span></button>)}{!catalog.length && <div className="hiveory-empty-panel"><PlugZap size={24} /><p>No verified plugin manifests are available.</p></div>}</div>{selected && <section className="hiveory-plugin-detail" aria-labelledby="hiveory-plugin-detail-title"><div className="hiveory-panel-heading"><div><p className="hiveory-eyebrow">Manifest inspection</p><h2 id="hiveory-plugin-detail-title">{selected.manifest.name}</h2></div><button onClick={() => void action(`install-${selected.manifest.id}`, () => hiveoryClient.installPlugin({ plugin_id: selected.manifest.id, enabled: !selected.enabled }), selected.enabled ? 'Plugin disabled.' : 'Plugin enabled.')} disabled={busy !== null}><ShieldCheck size={14} />{selected.enabled ? 'Disable' : 'Enable'}</button></div><p className="hiveory-muted-copy">{selected.manifest.description}</p><div className="hiveory-plugin-meta"><span><strong>Adapter</strong>{riskLabel(selected.manifest.adapter)}</span><span><strong>Hash</strong><code>{selected.manifest.content_hash.slice(0, 16)}…</code></span><span><strong>Hosts</strong>{selected.manifest.allowed_hosts.join(', ')}</span></div><div className="hiveory-plugin-permissions"><div className="hiveory-card-heading"><LockKeyhole size={15} /><h3>Permissions</h3></div>{selected.manifest.permissions.map((permission) => <div key={permission.capability}><strong>{permission.capability}</strong><span>{permission.explanation}</span></div>)}</div><div className="hiveory-plugin-tools"><div className="hiveory-card-heading"><PlugZap size={15} /><h3>Tools</h3><span>{selected.manifest.tools.length}</span></div>{selected.manifest.tools.map((tool) => <div key={tool.name} className="hiveory-plugin-tool"><span><strong>{tool.name}</strong><small>{tool.description}</small></span><span className={`hiveory-risk-badge ${tool.risk}`}>{riskLabel(tool.risk)}</span></div>)}</div><div className="hiveory-plugin-connections"><div className="hiveory-card-heading"><Link2 size={15} /><h3>Connections</h3><button className="is-secondary" onClick={() => setShowConnection(true)} disabled={!selected.enabled}><Plus size={14} />Add connection</button></div>{selectedConnections.length ? selectedConnections.map((connection) => <ConnectionRow key={connection.id} connection={connection} busy={busy} onTest={() => void action(`test-${connection.id}`, async () => { await hiveoryClient.testPluginConnection(connection.id) }, 'Connection validated.')} onDelete={() => void action(`delete-${connection.id}`, () => hiveoryClient.deletePluginConnection(connection.id), 'Connection removed.')} />) : <p className="hiveory-muted-copy">No connections yet. Add an HTTPS origin that matches the manifest allow-list.</p>}</div><PluginGrantEditor plugin={selected} connections={selectedConnections} agents={agents} busy={busy} onAction={action} /><PluginDryRun selected={selected} connections={selectedConnections} /></section>}</div>
    {feedback && <div className="hiveory-feedback" role="status">{feedback}</div>}
    {showConnection && selected && <ConnectionForm plugin={selected} busy={busy === 'connection'} onCancel={() => setShowConnection(false)} onSave={async (request) => { setBusy('connection'); setFeedback(null); try { await hiveoryClient.createPluginConnection(request); setShowConnection(false); setFeedback('Connection saved. Test it before granting it to an Agent.'); await refresh() } catch (error) { setFeedback(error instanceof Error ? error.message : 'The connection could not be saved.') } finally { setBusy(null) } }} />}
  </section>
}

function ConnectionRow({ connection, busy, onTest, onDelete }: { connection: PluginConnectionSummary; busy: string | null; onTest: () => void; onDelete: () => void }) {
  return <div className="hiveory-connection-row"><span className="hiveory-connection-icon"><Link2 size={15} /></span><span><strong>{connection.name}</strong><small><code>{connection.origin}</code> · {connection.secret_configured ? 'Key stored in keyring' : 'No secret required'}</small></span><span className={`hiveory-connection-check ${connection.validated_at_unix_ms ? 'is-valid' : ''}`}>{connection.validated_at_unix_ms ? <><Check size={13} />Validated</> : 'Not tested'}</span><button className="hiveory-icon-button" onClick={onTest} disabled={busy !== null} aria-label={`Test ${connection.name}`}><TestTube2 size={15} /></button><button className="hiveory-icon-button is-danger" onClick={onDelete} disabled={busy !== null} aria-label={`Delete ${connection.name}`}><Trash2 size={15} /></button></div>
}

function PluginGrantEditor({ plugin, connections, agents, busy, onAction }: { plugin: PluginCatalogEntry; connections: PluginConnectionSummary[]; agents: AgentSummary[]; busy: string | null; onAction: (key: string, work: () => Promise<void>, message: string) => Promise<void> }) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [grants, setGrants] = useState<AgentPluginGrant[]>([])
  useEffect(() => { if (!agentId) return; void hiveoryClient.agentPluginGrants(agentId).then(setGrants).catch(() => undefined) }, [agentId, plugin.manifest.id])
  useEffect(() => { if (!agentId && agents[0]) setAgentId(agents[0].id) }, [agentId, agents])
  const grant = grants.find((item) => item.plugin_id === plugin.manifest.id)
  const connection = connections.find((item) => item.id === grant?.connection_id) ?? connections[0]
  const enabled = Boolean(grant?.enabled)
  const toggle = async () => {
    if (!connection || !agentId) return
    await onAction(`grant-${plugin.manifest.id}`, async () => { const next = await hiveoryClient.setAgentPluginGrant({ agent_id: agentId, plugin_id: plugin.manifest.id, connection_id: connection.id, tool_names: plugin.manifest.tools.map((tool) => tool.name), enabled: !enabled }); setGrants((current) => [...current.filter((item) => item.plugin_id !== plugin.manifest.id), next]) }, enabled ? 'Plugin grant revoked.' : 'Plugin granted to the Agent.')
  }
  return <div className="hiveory-plugin-grants"><div className="hiveory-card-heading"><UserRound size={15} /><h3>Agent grants</h3></div><div className="hiveory-grant-controls"><label>Agent<select value={agentId} onChange={(event) => setAgentId(event.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><label>Connection<select value={connection?.id ?? ''} disabled={!connections.length}>{connections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button onClick={() => void toggle()} disabled={busy !== null || !connection || !plugin.enabled || !agentId}>{enabled ? 'Revoke grant' : 'Grant tools'}</button></div><p className="hiveory-muted-copy">Granting exposes only the selected manifest tools to this Agent. Mutating tools still pause for approval.</p></div>
}

function PluginDryRun({ selected, connections }: { selected: PluginCatalogEntry; connections: PluginConnectionSummary[] }) {
  const dryRunTool = selected.manifest.tools[0]
  const [output, setOutput] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [path, setPath] = useState('/incoming')
  const [body, setBody] = useState('{"event":"preview"}')
  if (!selected.manifest.supports_dry_run || !dryRunTool) return null
  const run = async () => { const connection = connections[0]; if (!connection) return; setBusy(true); try { setOutput(await hiveoryClient.dryRunPlugin({ plugin_id: selected.manifest.id, connection_id: connection.id, tool_name: dryRunTool.name, arguments_json: JSON.stringify({ path, body: JSON.parse(body) }) })) } catch (error) { setOutput(error instanceof Error ? error.message : 'Dry run failed.') } finally { setBusy(false) } }
  return <div className="hiveory-plugin-dry-run"><div className="hiveory-card-heading"><Eye size={15} /><h3>Safe dry run</h3><span>No network request</span></div><div className="hiveory-dry-run-form"><label>Path<input value={path} onChange={(event) => setPath(event.target.value)} /></label><label>JSON body<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={2} /></label><button className="is-secondary" onClick={() => void run()} disabled={busy || !connections.length}>{busy ? 'Previewing…' : 'Preview payload'}</button></div>{output && <pre className="hiveory-dry-run-output" aria-live="polite">{output}</pre>}</div>
}

function ConnectionForm({ plugin, busy, onCancel, onSave }: { plugin: PluginCatalogEntry; busy: boolean; onCancel: () => void; onSave: (request: PluginConnectionCreateRequest) => void }) {
  const [name, setName] = useState(`${plugin.manifest.name} connection`)
  const [origin, setOrigin] = useState(`https://${plugin.manifest.allowed_hosts[0] ?? ''}`)
  const [header, setHeader] = useState('X-API-Key')
  const [secret, setSecret] = useState('')
  const requiresSecret = plugin.manifest.connection_kind === 'api_key_header'
  return <div className="hiveory-modal-backdrop" role="presentation"><section className="hiveory-modal" role="dialog" aria-modal="true" aria-labelledby="hiveory-connection-title"><div className="hiveory-modal-heading"><div><p className="hiveory-eyebrow">{plugin.manifest.name}</p><h2 id="hiveory-connection-title">Add connection</h2></div><button className="hiveory-icon-button" onClick={onCancel} aria-label="Close connection form"><X size={17} /></button></div><p>Use an HTTPS origin from the verified allow-list. The secret is written directly to the operating system credential manager.</p><label>Name<input value={name} onChange={(event) => setName(event.target.value)} autoFocus maxLength={80} /></label><label>HTTPS origin<input value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="https://api.example.com" /></label>{requiresSecret && <><label>API key header<input value={header} onChange={(event) => setHeader(event.target.value)} maxLength={100} /></label><label>API key<input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="off" /></label></>}<div className="hiveory-modal-actions"><button className="is-secondary" onClick={onCancel}>Cancel</button><button disabled={busy || !name.trim() || !origin.trim() || requiresSecret && !secret.trim()} onClick={() => onSave({ plugin_id: plugin.manifest.id, name: name.trim(), origin: origin.trim(), kind: plugin.manifest.connection_kind, api_key_header: requiresSecret ? header.trim() : null, secret_value: requiresSecret ? secret : null })}><KeyRound size={15} />{busy ? 'Saving…' : 'Save securely'}</button></div></section></div>
}

export default HiveoryPlugins
