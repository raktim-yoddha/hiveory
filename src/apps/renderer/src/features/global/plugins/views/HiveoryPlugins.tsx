import { Check, Eye, KeyRound, Link2, LockKeyhole, MoreHorizontal, PlugZap, Plus, RefreshCw, Search, TestTube2, Trash2, UserRound, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { hiveoryClient, type AgentPluginGrant, type AgentSummary, type PluginCatalogEntry, type PluginConnectionCreateRequest, type PluginConnectionSummary, type PluginManifest } from '../../../../shared/api/hiveory-client'
import { HiveorySkills } from '../../skills/views/HiveorySkills'

function riskLabel(value: string) { return value.replaceAll('_', ' ') }
const providerTokenDefaults: Record<string, { header: string; origin?: string; hint: string }> = {
  github: { header: 'Authorization', hint: 'Paste `Bearer <GitHub fine-grained token>`.' },
  linear: { header: 'Authorization', hint: 'Paste `Bearer <Linear personal API key>`.' },
  gmail: { header: 'Authorization', hint: 'Paste `Bearer <Google OAuth access token>`.' },
  slack: { header: 'Authorization', origin: 'https://slack.com', hint: 'Paste `Bearer <Slack user or bot token>`.' },
  notion: { header: 'Authorization', hint: 'Paste `Bearer <Notion integration token>`.' },
  cloudflare: { header: 'Authorization', hint: 'Paste `Bearer <Cloudflare API token>`.' },
  supabase: { header: 'Authorization', hint: 'Paste `Bearer <Supabase personal access token>`.' },
  vercel: { header: 'Authorization', hint: 'Paste `Bearer <Vercel access token>`.' },
  stripe: { header: 'Authorization', hint: 'Paste `Bearer <Stripe restricted key>`.' },
  shopify: { header: 'X-Shopify-Access-Token', origin: 'https://your-store.myshopify.com', hint: 'Replace the store domain and paste a custom-app access token.' },
}
type PluginDraft = { id: string; name: string; description: string; host: string; toolName: string; method: 'json_http_get' | 'json_http_post' }
const emptyPluginDraft: PluginDraft = { id: '', name: '', description: '', host: '', toolName: 'get', method: 'json_http_get' }
type CapabilityTab = 'plugins' | 'mcp' | 'skills'
type PluginSubtab = 'manual' | 'connected'
function customPluginManifest(draft: PluginDraft): PluginManifest {
  const host = draft.host.trim().replace(/^https:\/\//, '').replace(/\/$/, '')
  const adapter = draft.method
  return {
    id: draft.id.trim(), publisher: 'Local Hiveory user', version: '1.0.0', name: draft.name.trim(), description: draft.description.trim(), adapter,
    tools: [{ name: draft.toolName.trim(), description: `${adapter === 'json_http_get' ? 'Read' : 'Send'} an approved request to ${host}.`, adapter, input_schema_json: JSON.stringify({ type: 'object', properties: { path: { type: 'string' }, body: { type: 'object' } }, required: ['path'], additionalProperties: false }), output_schema_json: JSON.stringify({ type: 'object' }), risk: adapter === 'json_http_post' ? 'externally_visible' : 'read_only' }],
    permissions: [{ capability: 'network.https', explanation: `HTTPS requests only to ${host}.` }, { capability: 'credentials.user_owned', explanation: 'A user-provided credential is stored in the operating-system keyring.' }],
    allowed_hosts: [host], connection_kind: 'api_key_header', supports_dry_run: adapter === 'json_http_post', content_hash: '',
  }
}
function pluginMark(entry: PluginCatalogEntry) {
  return <span className={`hiveory-plugin-mark is-${entry.manifest.id.replaceAll(/[^a-z0-9-]/gi, '-').toLocaleLowerCase()}`} aria-hidden="true">{entry.manifest.name.trim().slice(0, 2).toUpperCase()}</span>
}

export function HiveoryPlugins() {
  const [activeTab, setActiveTab] = useState<CapabilityTab>('plugins')
  const [pluginSubtab, setPluginSubtab] = useState<PluginSubtab>('manual')
  const [catalog, setCatalog] = useState<PluginCatalogEntry[]>([])
  const [connections, setConnections] = useState<PluginConnectionSummary[]>([])
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [showConnection, setShowConnection] = useState(false)
  const [showCreator, setShowCreator] = useState(false)
  const [showConfiguration, setShowConfiguration] = useState(false)
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const [creator, setCreator] = useState<PluginDraft>(emptyPluginDraft)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [rawCatalog, nextConnections, nextAgents] = await Promise.all([hiveoryClient.pluginCatalog(), hiveoryClient.pluginConnections(), hiveoryClient.agents()])
      setCatalog(rawCatalog); setConnections(nextConnections.filter((connection) => rawCatalog.some((entry) => entry.manifest.id === connection.plugin_id))); setAgents(nextAgents); setSelectedId((current) => current && rawCatalog.some((entry) => entry.manifest.id === current) ? current : rawCatalog[0]?.manifest.id ?? null)
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Plugin catalog could not be loaded.') }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    const selectTab = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: CapabilityTab }>).detail?.tab
      if (tab === 'plugins' || tab === 'mcp' || tab === 'skills') setActiveTab(tab)
    }
    window.addEventListener('hiveory-capability-tab', selectTab)
    return () => window.removeEventListener('hiveory-capability-tab', selectTab)
  }, [])

  const selected = catalog.find((entry) => entry.manifest.id === selectedId) ?? catalog[0]
  const selectedConnections = connections.filter((connection) => connection.plugin_id === selected?.manifest.id)
  const visibleCatalog = catalog.filter((entry) => {
    const pluginConnections = connections.filter((connection) => connection.plugin_id === entry.manifest.id)
    const searchText = `${entry.manifest.name} ${entry.manifest.description} ${pluginConnections.map((connection) => `${connection.name} ${connection.origin}`).join(' ')}`.toLocaleLowerCase()
    return (pluginSubtab === 'manual' || pluginConnections.length > 0) && searchText.includes(query.trim().toLocaleLowerCase())
  })
  const action = async (key: string, work: () => Promise<void>, message: string) => { setBusy(key); setFeedback(null); try { await work(); setFeedback(message); await refresh() } catch (error) { setFeedback(error instanceof Error ? error.message : 'The plugin action could not be completed.') } finally { setBusy(null) } }
  const importManifest = async () => { setBusy('import'); setFeedback(null); try { const imported = await hiveoryClient.importPluginManifest(); if (imported) { setFeedback(`${imported.manifest.name} imported.`); await refresh() } } catch (error) { setFeedback(error instanceof Error ? error.message : 'The plugin manifest could not be imported.') } finally { setBusy(null) } }
  const createPlugin = async () => { setBusy('create'); setFeedback(null); try { const created = await hiveoryClient.registerPluginManifest(customPluginManifest(creator)); setCreator(emptyPluginDraft); setShowCreator(false); setSelectedId(created.manifest.id); setFeedback(`${created.manifest.name} created. Connect it with a user-owned token to use its tool.`); await refresh() } catch (error) { setFeedback(error instanceof Error ? error.message : 'The custom plugin could not be created.') } finally { setBusy(null) } }

  const openConfiguration = (pluginId: string) => { setSelectedId(pluginId); setOpenMenuId(null); setShowConfiguration(true) }
  const selectPluginSubtab = (next: PluginSubtab) => { setPluginSubtab(next); setQuery('') }
  const openConnection = (pluginId: string) => { setSelectedId(pluginId); setOpenMenuId(null); setShowConnection(true) }

  return <section className="hiveory-capability-hub" aria-labelledby="hiveory-capability-title">
    <header className="hiveory-capability-header">
      <div><h1 id="hiveory-capability-title">Plugins</h1><p>Connect plugins, manage MCP servers, and assign skills.</p></div>
      <button className="hiveory-icon-button hiveory-capability-refresh" onClick={() => activeTab === 'skills' ? window.dispatchEvent(new Event('hiveory-refresh-skills')) : void refresh()} aria-label={`Refresh ${activeTab}`} disabled={busy !== null}><RefreshCw size={18} /></button>
    </header>
    <nav className="hiveory-capability-tabs" aria-label="Capability sections">
      {(['plugins', 'mcp', 'skills'] as CapabilityTab[]).map((tab) => <button key={tab} type="button" className={activeTab === tab ? 'is-active' : ''} aria-current={activeTab === tab ? 'page' : undefined} onClick={() => setActiveTab(tab)}>{tab === 'mcp' ? 'MCP' : `${tab[0].toUpperCase()}${tab.slice(1)}`}</button>)}
    </nav>
    {activeTab === 'plugins' && <>
      <div className="hiveory-capability-toolbar">
        <div className="hiveory-plugin-subtabs" role="tablist" aria-label="Plugin views"><button role="tab" aria-selected={pluginSubtab === 'manual'} className={pluginSubtab === 'manual' ? 'is-active' : ''} onClick={() => selectPluginSubtab('manual')}>Manual</button><button role="tab" aria-selected={pluginSubtab === 'connected'} className={pluginSubtab === 'connected' ? 'is-active' : ''} onClick={() => selectPluginSubtab('connected')}>Connected {connections.length}</button></div>
        <label className="hiveory-capability-search"><Search size={17} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search plugins" aria-label="Search plugins" /></label>
      </div>
      <div className="hiveory-capability-section-heading"><h2>{pluginSubtab === 'manual' ? 'Available plugins' : 'Connected plugins'}</h2><div className="hiveory-capability-actions"><button className="is-secondary" onClick={() => setShowCreator(true)} disabled={busy !== null}><Plus size={15} />Add custom</button><button className="is-secondary" onClick={() => void importManifest()} disabled={busy !== null}>Import</button></div></div>
      <div className="hiveory-plugin-catalog-grid" aria-label={pluginSubtab === 'manual' ? 'Available plugins' : 'Connected plugins'}>
        {visibleCatalog.map((entry) => {
          const pluginConnections = connections.filter((connection) => connection.plugin_id === entry.manifest.id)
          return <article key={entry.manifest.id} className="hiveory-plugin-provider">
            <div className="hiveory-plugin-provider-main">{pluginMark(entry)}<button className="hiveory-plugin-provider-copy" onClick={() => openConfiguration(entry.manifest.id)}><strong>{entry.manifest.name}</strong><small>{entry.manifest.description}</small></button><div className="hiveory-plugin-menu-wrap"><button className="hiveory-icon-button" aria-label={`More options for ${entry.manifest.name}`} aria-expanded={openMenuId === entry.manifest.id} onClick={() => setOpenMenuId((current) => current === entry.manifest.id ? null : entry.manifest.id)}><MoreHorizontal size={18} /></button>{openMenuId === entry.manifest.id && <div className="hiveory-plugin-menu" role="menu"><button onClick={() => openConfiguration(entry.manifest.id)}>Configure</button><button onClick={() => openConnection(entry.manifest.id)} disabled={!entry.enabled}>Add connection</button><button onClick={() => void action(`install-${entry.manifest.id}`, () => hiveoryClient.installPlugin({ plugin_id: entry.manifest.id, enabled: !entry.enabled }), entry.enabled ? `${entry.manifest.name} disabled.` : `${entry.manifest.name} enabled.`)}>{entry.enabled ? 'Disable' : 'Enable'}</button></div>}</div><button className="hiveory-plugin-connect-button" onClick={() => openConnection(entry.manifest.id)} disabled={!entry.enabled || busy !== null}>{pluginConnections.length ? 'Add account' : 'Connect'}</button></div>
            {pluginConnections.length > 0 && <div className="hiveory-plugin-account-list">{pluginConnections.map((connection) => <div key={connection.id} className="hiveory-plugin-account"><span><strong>{connection.name}</strong><small>{connection.origin}</small></span><b className={connection.validated_at_unix_ms ? 'is-validated' : 'is-untested'}>{connection.validated_at_unix_ms ? <><Check size={13} />Validated</> : 'Not tested'}</b><button className="hiveory-icon-button" onClick={() => void action(`test-${connection.id}`, async () => { await hiveoryClient.testPluginConnection(connection.id) }, 'Connection validated.')} disabled={busy !== null} aria-label={`Test ${connection.name}`}><TestTube2 size={15} /></button><button className="hiveory-plugin-disconnect" onClick={() => void action(`delete-${connection.id}`, () => hiveoryClient.deletePluginConnection(connection.id), 'Connection removed.')} disabled={busy !== null}>Disconnect</button></div>)}</div>}
          </article>
        })}
        {!visibleCatalog.length && <div className="hiveory-capability-empty"><PlugZap size={24} /><h2>{query ? 'No plugins match your search.' : pluginSubtab === 'connected' ? 'No connections yet.' : 'Plugins are loading.'}</h2>{!query && pluginSubtab === 'connected' && <p>Connect a plugin to manage its accounts here.</p>}</div>}
      </div>
    </>}
    {activeTab === 'mcp' && <div className="hiveory-capability-empty hiveory-mcp-empty"><PlugZap size={24} /><h2>MCP server management is not available yet.</h2><p>Hiveory currently supplies its MCP bridge through the active session.</p></div>}
    {activeTab === 'skills' && <HiveorySkills embedded />}
    {feedback && <div className="hiveory-feedback" role="status">{feedback}</div>}
    {showConfiguration && selected && <div className="hiveory-modal-backdrop" role="presentation"><section className="hiveory-modal hiveory-plugin-config-modal" role="dialog" aria-modal="true" aria-labelledby="hiveory-plugin-detail-title"><div className="hiveory-modal-heading"><div className="hiveory-plugin-config-title">{pluginMark(selected)}<div><p className="hiveory-eyebrow">Local provider adapter</p><h2 id="hiveory-plugin-detail-title">{selected.manifest.name}</h2></div></div><button className="hiveory-icon-button" onClick={() => { setShowConfiguration(false); setShowConnection(false) }} aria-label="Close plugin configuration"><X size={17} /></button></div><p className="hiveory-muted-copy">{selected.manifest.description}</p><div className="hiveory-plugin-meta"><span><strong>Transport</strong>{riskLabel(selected.manifest.adapter)}</span><span><strong>Credentials</strong>{selected.manifest.connection_kind === 'api_key_header' ? 'OS keyring' : 'No secret required'}</span><span><strong>Allow-list</strong>{selected.manifest.allowed_hosts.join(', ') || 'None declared'}</span></div><div className="hiveory-plugin-permissions"><div className="hiveory-card-heading"><LockKeyhole size={15} /><h3>Permissions</h3></div>{selected.manifest.permissions.map((permission) => <div key={permission.capability}><strong>{permission.capability}</strong><span>{permission.explanation}</span></div>)}</div><div className="hiveory-plugin-tools"><div className="hiveory-card-heading"><PlugZap size={15} /><h3>Available tools</h3><span>{selected.manifest.tools.length}</span></div>{selected.manifest.tools.map((tool) => <div key={tool.name} className="hiveory-plugin-tool"><span><strong>{tool.name}</strong><small>{tool.description}</small></span><span className={`hiveory-risk-badge ${tool.risk}`}>{riskLabel(tool.risk)}</span></div>)}</div><div className="hiveory-plugin-connections"><div className="hiveory-card-heading"><Link2 size={15} /><h3>Connections</h3><button className="is-secondary" onClick={() => setShowConnection(true)} disabled={!selected.enabled}><Plus size={14} />Add connection</button></div>{selectedConnections.length ? selectedConnections.map((connection) => <ConnectionRow key={connection.id} connection={connection} busy={busy} onTest={() => void action(`test-${connection.id}`, async () => { await hiveoryClient.testPluginConnection(connection.id) }, 'Connection validated.')} onDelete={() => void action(`delete-${connection.id}`, () => hiveoryClient.deletePluginConnection(connection.id), 'Connection removed.')} />) : <p className="hiveory-muted-copy">Add and test a connection before granting this provider to an agent.</p>}</div><PluginGrantEditor plugin={selected} connections={selectedConnections} agents={agents} busy={busy} onAction={action} /><PluginDryRun selected={selected} connections={selectedConnections} /></section></div>}
    {showConnection && selected && <ConnectionForm plugin={selected} busy={busy === 'connection'} onCancel={() => setShowConnection(false)} onSave={async (request) => { setBusy('connection'); setFeedback(null); try { await hiveoryClient.createPluginConnection(request); setShowConnection(false); setFeedback('Connection saved. Test it before granting it to an Agent.'); await refresh() } catch (error) { setFeedback(error instanceof Error ? error.message : 'The connection could not be saved.') } finally { setBusy(null) } }} />}
    {showCreator && <PluginCreator draft={creator} busy={busy === 'create'} onChange={setCreator} onCancel={() => { if (busy !== 'create') setShowCreator(false) }} onCreate={() => void createPlugin()} />}
  </section>
}

function ConnectionRow({ connection, busy, onTest, onDelete }: { connection: PluginConnectionSummary; busy: string | null; onTest: () => void; onDelete: () => void }) {
  return <div className="hiveory-connection-row"><span className="hiveory-connection-icon"><Link2 size={15} /></span><span><strong>{connection.name}</strong><small><code>{connection.origin}</code> · {connection.secret_configured ? 'Key stored in keyring' : 'No secret required'}</small></span><span className={`hiveory-connection-check ${connection.validated_at_unix_ms ? 'is-valid' : ''}`}>{connection.validated_at_unix_ms ? <><Check size={13} />Validated</> : 'Not tested'}</span><button className="hiveory-icon-button" onClick={onTest} disabled={busy !== null} aria-label={`Test ${connection.name}`}><TestTube2 size={15} /></button><button className="hiveory-icon-button is-danger" onClick={onDelete} disabled={busy !== null} aria-label={`Delete ${connection.name}`}><Trash2 size={15} /></button></div>
}

function PluginGrantEditor({ plugin, connections, agents, busy, onAction }: { plugin: PluginCatalogEntry; connections: PluginConnectionSummary[]; agents: AgentSummary[]; busy: string | null; onAction: (key: string, work: () => Promise<void>, message: string) => Promise<void> }) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '')
  const [grants, setGrants] = useState<AgentPluginGrant[]>([])
  const [connectionId, setConnectionId] = useState('')
  useEffect(() => { if (!agentId) return; void hiveoryClient.agentPluginGrants(agentId).then(setGrants).catch(() => undefined) }, [agentId, plugin.manifest.id])
  useEffect(() => { if (!agentId && agents[0]) setAgentId(agents[0].id) }, [agentId, agents])
  const grantedConnectionId = grants.find((item) => item.plugin_id === plugin.manifest.id && item.enabled)?.connection_id ?? connections.find((item) => item.validated_at_unix_ms)?.id ?? connections[0]?.id ?? ''
  useEffect(() => { setConnectionId((current) => connections.some((connection) => connection.id === current) ? current : grantedConnectionId) }, [connections, grantedConnectionId])
  const connection = connections.find((item) => item.id === connectionId) ?? connections[0]
  const grant = grants.find((item) => item.plugin_id === plugin.manifest.id && item.connection_id === connection?.id)
  const enabled = Boolean(grant?.enabled)
  const canGrant = enabled || Boolean(connection?.validated_at_unix_ms)
  const toggle = async () => {
    if (!connection || !agentId) return
    await onAction(`grant-${plugin.manifest.id}`, async () => { const next = await hiveoryClient.setAgentPluginGrant({ agent_id: agentId, plugin_id: plugin.manifest.id, connection_id: connection.id, tool_names: plugin.manifest.tools.map((tool) => tool.name), enabled: !enabled }); setGrants((current) => [...current.filter((item) => item.plugin_id !== plugin.manifest.id), next]) }, enabled ? 'Plugin grant revoked.' : 'Plugin granted to the Agent.')
  }
  return <div className="hiveory-plugin-grants"><div className="hiveory-card-heading"><UserRound size={15} /><h3>Agent grants</h3></div><div className="hiveory-grant-controls"><label>Agent<select value={agentId} onChange={(event) => setAgentId(event.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label><label>Connection<select value={connection?.id ?? ''} onChange={(event) => setConnectionId(event.target.value)} disabled={!connections.length}>{connections.map((item) => <option key={item.id} value={item.id}>{item.name}{item.validated_at_unix_ms ? ' · tested' : ' · test required'}</option>)}</select></label><button onClick={() => void toggle()} disabled={busy !== null || !connection || !plugin.enabled || !agentId || !canGrant}>{enabled ? 'Revoke grant' : 'Grant tools'}</button></div><p className="hiveory-muted-copy">{connection && !connection.validated_at_unix_ms && !enabled ? 'Test this connection before granting its tools. ' : ''}Granting exposes only the selected manifest tools to this Hiveory Agent. Mutating tools still pause for approval.</p></div>
}

function PluginDryRun({ selected, connections }: { selected: PluginCatalogEntry; connections: PluginConnectionSummary[] }) {
  const dryRunTool = selected.manifest.tools[0]
  const [output, setOutput] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [path, setPath] = useState('/incoming')
  const [body, setBody] = useState('{}')
  if (!selected.manifest.supports_dry_run || !dryRunTool) return null
  const run = async () => { const connection = connections[0]; if (!connection) return; setBusy(true); try { setOutput(await hiveoryClient.dryRunPlugin({ plugin_id: selected.manifest.id, connection_id: connection.id, tool_name: dryRunTool.name, arguments_json: JSON.stringify({ path, body: JSON.parse(body) }) })) } catch (error) { setOutput(error instanceof Error ? error.message : 'Dry run failed.') } finally { setBusy(false) } }
  return <div className="hiveory-plugin-dry-run"><div className="hiveory-card-heading"><Eye size={15} /><h3>Safe dry run</h3><span>No network request</span></div><div className="hiveory-dry-run-form"><label>Path<input value={path} onChange={(event) => setPath(event.target.value)} /></label><label>JSON body<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={2} /></label><button className="is-secondary" onClick={() => void run()} disabled={busy || !connections.length}>{busy ? 'Running…' : 'Inspect request'}</button></div>{output && <pre className="hiveory-dry-run-output" aria-live="polite">{output}</pre>}</div>
}

function ConnectionForm({ plugin, busy, onCancel, onSave }: { plugin: PluginCatalogEntry; busy: boolean; onCancel: () => void; onSave: (request: PluginConnectionCreateRequest) => void }) {
  const [name, setName] = useState(`${plugin.manifest.name} connection`)
  const defaults = providerTokenDefaults[plugin.manifest.id]
  const [origin, setOrigin] = useState(defaults?.origin ?? `https://${plugin.manifest.allowed_hosts[0] ?? ''}`)
  const [header, setHeader] = useState(defaults?.header ?? 'Authorization')
  const [secret, setSecret] = useState('')
  const requiresSecret = plugin.manifest.connection_kind === 'api_key_header'
  return <div className="hiveory-modal-backdrop" role="presentation"><section className="hiveory-modal" role="dialog" aria-modal="true" aria-labelledby="hiveory-connection-title"><div className="hiveory-modal-heading"><div><p className="hiveory-eyebrow">{plugin.manifest.name}</p><h2 id="hiveory-connection-title">Connect account</h2></div><button className="hiveory-icon-button" onClick={onCancel} aria-label="Close connection form"><X size={17} /></button></div><p>Hiveory stores this credential only in the operating-system keyring. {defaults?.hint ?? 'Use a token with only the scopes this connection needs.'}</p><label>Name<input value={name} onChange={(event) => setName(event.target.value)} autoFocus maxLength={80} /></label><label>HTTPS origin<input value={origin} onChange={(event) => setOrigin(event.target.value)} placeholder="https://api.example.com" /></label>{requiresSecret && <><label>Authorization header<input value={header} onChange={(event) => setHeader(event.target.value)} maxLength={100} /></label><label>Access token<input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} autoComplete="off" /></label></>}<div className="hiveory-modal-actions"><button className="is-secondary" onClick={onCancel}>Cancel</button><button disabled={busy || !name.trim() || !origin.trim() || requiresSecret && !secret.trim()} onClick={() => onSave({ plugin_id: plugin.manifest.id, name: name.trim(), origin: origin.trim(), kind: plugin.manifest.connection_kind, api_key_header: requiresSecret ? header.trim() : null, secret_value: requiresSecret ? secret : null })}><KeyRound size={15} />{busy ? 'Saving…' : 'Save securely'}</button></div></section></div>
}

function PluginCreator({ draft, busy, onChange, onCancel, onCreate }: { draft: PluginDraft; busy: boolean; onChange: (draft: PluginDraft) => void; onCancel: () => void; onCreate: () => void }) {
  const update = <K extends keyof PluginDraft>(key: K, value: PluginDraft[K]) => onChange({ ...draft, [key]: value })
  return <div className="hiveory-modal-backdrop" role="presentation"><section className="hiveory-modal hiveory-routine-modal" role="dialog" aria-modal="true" aria-labelledby="hiveory-plugin-creator-title"><div className="hiveory-modal-heading"><div><p className="hiveory-eyebrow">Local provider adapter</p><h2 id="hiveory-plugin-creator-title">Create plugin</h2></div><button className="hiveory-icon-button" onClick={onCancel} aria-label="Close plugin creator"><X size={17} /></button></div><p>Creates a local, allow-listed HTTPS adapter. Add your own token afterward; it stays in the operating-system keyring.</p><div className="hiveory-form-grid"><label>Identifier<input value={draft.id} onChange={(event) => update('id', event.target.value)} placeholder="status-api" autoFocus maxLength={64} /><small>Lowercase letters, numbers, and dashes.</small></label><label>Name<input value={draft.name} onChange={(event) => update('name', event.target.value)} placeholder="Status API" maxLength={80} /></label><label className="is-wide">Description<input value={draft.description} onChange={(event) => update('description', event.target.value)} placeholder="What this plugin can do" maxLength={240} /></label><label>Allowed HTTPS host<input value={draft.host} onChange={(event) => update('host', event.target.value)} placeholder="api.example.com" maxLength={255} /></label><label>Tool name<input value={draft.toolName} onChange={(event) => update('toolName', event.target.value)} placeholder="get" maxLength={64} /></label><label>Method<select value={draft.method} onChange={(event) => update('method', event.target.value as PluginDraft['method'])}><option value="json_http_get">Read-only GET</option><option value="json_http_post">Approved POST with dry run</option></select></label></div><div className="hiveory-modal-actions"><button className="is-secondary" onClick={onCancel}>Cancel</button><button disabled={busy || !draft.id.trim() || !draft.name.trim() || !draft.description.trim() || !draft.host.trim() || !draft.toolName.trim()} onClick={onCreate}><Plus size={15} />{busy ? 'Creating…' : 'Create plugin'}</button></div></section></div>
}

export default HiveoryPlugins
