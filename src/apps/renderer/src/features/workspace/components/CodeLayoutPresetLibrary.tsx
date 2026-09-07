import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Edit3, FolderOpen, Globe, LayoutTemplate, MonitorPlay, Plus, Terminal, Trash2, X } from 'lucide-react'
import { hiveoryClient, type CodeAdapterSummary, type CodeLaunchPresetEntry, type CodeLaunchPresetPaneKind, type CodeLaunchPresetSummary } from '../../../shared/api/hiveory-client'
import { CliBrandIcon } from './CliIcons'
import { supportsYoloLaunch } from '../model/code-yolo-preferences'

interface CodeLayoutPresetLibraryProps {
  workspaceId: string
  adapters: CodeAdapterSummary[]
  onOpenPreset: (preset: CodeLaunchPresetSummary) => Promise<void>
  onClose: () => void
}

const newEntry = (kind: CodeLaunchPresetPaneKind, adapterId?: string): CodeLaunchPresetEntry => ({
  id: `preset-entry-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  kind,
  title: kind === 'coding_agent' ? 'Implementer' : kind === 'terminal' ? 'Terminal' : kind === 'browser' ? 'Browser' : 'Notes',
  adapter_id: kind === 'coding_agent' ? adapterId ?? null : null,
  url: kind === 'browser' ? 'https://www.google.com' : null,
  agent_launch_mode: 'standard',
})

const paneIcon = (entry: CodeLaunchPresetEntry, adapters: CodeAdapterSummary[]) => {
  if (entry.kind === 'coding_agent') {
    const adapter = adapters.find((candidate) => candidate.id === entry.adapter_id)
    return adapter ? <CliBrandIcon identifier={adapter.id} size={16} /> : <MonitorPlay size={16} />
  }
  if (entry.kind === 'terminal') return <Terminal size={16} />
  if (entry.kind === 'browser') return <Globe size={16} />
  return <LayoutTemplate size={16} />
}

export const CodeLayoutPresetLibrary: React.FC<CodeLayoutPresetLibraryProps> = ({ workspaceId, adapters, onOpenPreset, onClose }) => {
  const detectedAdapters = useMemo(() => adapters.filter((adapter) => adapter.detected), [adapters])
  const [tab, setTab] = useState<'load' | 'create'>('load')
  const [presets, setPresets] = useState<CodeLaunchPresetSummary[]>([])
  const [editing, setEditing] = useState<CodeLaunchPresetSummary | null>(null)
  const [name, setName] = useState('')
  const [entries, setEntries] = useState<CodeLaunchPresetEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const load = useCallback(async () => {
    try { setPresets(await hiveoryClient.codeLaunchPresets({ workspace_id: workspaceId })) }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Presets could not be loaded.') }
  }, [workspaceId])

  useEffect(() => { void load() }, [load])

  const startCreate = () => {
    setEditing(null)
    setName('')
    setEntries([newEntry(detectedAdapters.length ? 'coding_agent' : 'terminal', detectedAdapters[0]?.id)])
    setFeedback(null)
    setTab('create')
  }

  const startEdit = (preset: CodeLaunchPresetSummary) => {
    setEditing(preset)
    setName(preset.name)
    setEntries(structuredClone(preset.entries))
    setFeedback(null)
    setTab('create')
  }

  const updateEntry = (id: string, patch: Partial<CodeLaunchPresetEntry>) => setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, ...patch } : entry))

  const changeKind = (entry: CodeLaunchPresetEntry, kind: CodeLaunchPresetPaneKind) => {
    updateEntry(entry.id, { kind, adapter_id: kind === 'coding_agent' ? detectedAdapters[0]?.id ?? null : null, url: kind === 'browser' ? 'https://www.google.com' : null, agent_launch_mode: 'standard' })
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || entries.length === 0 || busy) return
    setBusy(true); setFeedback(null)
    try {
      if (editing) await hiveoryClient.updateCodeLaunchPreset({ preset_id: editing.id, workspace_id: workspaceId, name: name.trim(), entries })
      else await hiveoryClient.createCodeLaunchPreset({ workspace_id: workspaceId, name: name.trim(), entries })
      await load(); setTab('load'); setEditing(null)
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'Preset could not be saved.') }
    finally { setBusy(false) }
  }

  const open = async (preset: CodeLaunchPresetSummary) => {
    if (busy) return
    setBusy(true); setFeedback(null)
    try { await onOpenPreset(preset); onClose() }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Preset could not be opened.') }
    finally { setBusy(false) }
  }

  return <div className="code-layout-preset-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="code-layout-preset-modal" role="dialog" aria-modal="true" aria-labelledby="code-layout-preset-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="code-layout-preset-heading"><div><span className="code-dialog-eyebrow">Workspace setup</span><h2 id="code-layout-preset-title">Pane presets</h2></div><button type="button" className="code-pane-action-btn" onClick={onClose} aria-label="Close pane presets"><X size={16} /></button></header>
      <div className="code-layout-preset-tabs" role="tablist" aria-label="Pane preset actions"><button type="button" role="tab" aria-selected={tab === 'load'} className={tab === 'load' ? 'is-active' : ''} onClick={() => { setEditing(null); setFeedback(null); setTab('load') }}><FolderOpen size={14} />Load presets</button><button type="button" role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'is-active' : ''} onClick={startCreate}><Plus size={14} />Create preset</button></div>
      {tab === 'load' ? <div className="code-layout-preset-list">
        {presets.length ? presets.map((preset) => <article key={preset.id} className="code-layout-preset-row"><span className="code-layout-preset-icon"><LayoutTemplate size={16} /></span><span className="code-layout-preset-copy"><strong>{preset.name}</strong><small>{preset.entries.map((entry) => entry.title).join(' · ')}</small><em>{preset.entries.length} pane{preset.entries.length === 1 ? '' : 's'} ready to open</em></span><span className="code-layout-preset-actions"><button type="button" className="code-secondary-button" onClick={() => startEdit(preset)}><Edit3 size={13} />Edit</button><button type="button" className="code-primary-button" disabled={busy} onClick={() => void open(preset)}><FolderOpen size={13} />Open</button></span></article>) : <div className="code-layout-preset-empty"><LayoutTemplate size={22} /><strong>No saved presets</strong><span>Build a workspace setup once, then open every configured pane together.</span><button type="button" className="code-primary-button" onClick={startCreate}><Plus size={14} />Create preset</button></div>}
      </div> : <form className="code-layout-preset-form" onSubmit={save}>
        <div><span className="code-dialog-eyebrow">{editing ? 'Edit workspace setup' : 'Build workspace setup'}</span><h3>{editing ? editing.name : 'Create a pane preset'}</h3><p>Add every agent, browser, terminal, or Markdown pane this workflow needs. Opening the preset will create all of them together.</p></div>
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus placeholder="e.g. Feature review" /></label>
        <div className="code-launch-preset-entries" aria-label="Preset panes">{entries.map((entry, index) => <article key={entry.id} className="code-launch-preset-entry"><span className="code-launch-preset-entry-icon">{paneIcon(entry, adapters)}</span><span className="code-launch-preset-entry-body"><span className="code-launch-preset-entry-header"><strong>Pane {index + 1}</strong><button type="button" className="code-icon-button" onClick={() => setEntries((current) => current.filter((item) => item.id !== entry.id))} disabled={entries.length === 1} aria-label={`Remove ${entry.title}`}><Trash2 size={14} /></button></span><span className="code-launch-preset-entry-fields"><select value={entry.kind} onChange={(event) => changeKind(entry, event.target.value as CodeLaunchPresetPaneKind)} aria-label="Pane type"><option value="coding_agent">Coding agent</option><option value="terminal">Terminal</option><option value="browser">Browser</option><option value="markdown">Markdown</option></select><input value={entry.title} maxLength={80} onChange={(event) => updateEntry(entry.id, { title: event.target.value })} aria-label="Pane role" placeholder="Role or title" />{entry.kind === 'coding_agent' && <select value={entry.adapter_id ?? ''} onChange={(event) => updateEntry(entry.id, { adapter_id: event.target.value || null })} aria-label="Coding agent"><option value="" disabled>Select installed agent</option>{detectedAdapters.map((adapter) => <option key={adapter.id} value={adapter.id}>{adapter.display_name}</option>)}</select>}{entry.kind === 'browser' && <input value={entry.url ?? ''} onChange={(event) => updateEntry(entry.id, { url: event.target.value })} aria-label="Browser URL" placeholder="https://www.google.com" />}</span>{entry.kind === 'coding_agent' && supportsYoloLaunch(entry.adapter_id ?? undefined) && <label className="code-layout-preset-checkbox"><input type="checkbox" checked={entry.agent_launch_mode === 'yolo'} onChange={(event) => updateEntry(entry.id, { agent_launch_mode: event.target.checked ? 'yolo' : 'standard' })} /><span>Launch this session in YOLO mode</span></label>}</span></article>)}</div>
        <div className="code-launch-preset-add"><span>Add pane</span><button type="button" className="code-secondary-button" onClick={() => setEntries((current) => [...current, newEntry('coding_agent', detectedAdapters[0]?.id)])}><MonitorPlay size={14} />Agent</button><button type="button" className="code-secondary-button" onClick={() => setEntries((current) => [...current, newEntry('terminal')])}><Terminal size={14} />Terminal</button><button type="button" className="code-secondary-button" onClick={() => setEntries((current) => [...current, newEntry('browser')])}><Globe size={14} />Browser</button><button type="button" className="code-secondary-button" onClick={() => setEntries((current) => [...current, newEntry('markdown')])}><LayoutTemplate size={14} />Markdown</button></div>
        <div className="code-layout-preset-form-actions"><button type="button" className="code-secondary-button" onClick={() => { setEditing(null); setFeedback(null); setTab('load') }}>Cancel</button><button type="submit" className="code-primary-button" disabled={busy || !name.trim() || entries.length === 0}><Check size={14} />{busy ? 'Saving…' : editing ? 'Save changes' : 'Create preset'}</button></div>
      </form>}
      {feedback && <p className="code-layout-preset-feedback" role="status">{feedback}</p>}
    </section>
  </div>
}
