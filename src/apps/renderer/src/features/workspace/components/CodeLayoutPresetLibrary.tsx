import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown, ChevronUp, CircleMinus, CirclePlus, Edit3, FileText, FolderOpen, Globe, LayoutTemplate, MonitorPlay, Plus, Terminal, X, Zap } from 'lucide-react'
import { DEFAULT_BROWSER_HOME, hiveoryClient, type CodeAdapterSummary, type CodeLaunchPresetEntry, type CodeLaunchPresetPaneKind, type CodeLaunchPresetSummary } from '../../../shared/api/hiveory-client'
import { CliBrandIcon } from './CliIcons'
import { supportsYoloLaunch } from '../model/code-yolo-preferences'
import { entryGroupKey, groupPresetEntries, hasDuplicatePaneTitles, nextPetPaneTitle } from '../model/code-launch-preset-builder'

interface CodeLayoutPresetLibraryProps {
  workspaceId: string
  adapters: CodeAdapterSummary[]
  onOpenPreset: (preset: CodeLaunchPresetSummary) => Promise<void>
  onClose: () => void
}

interface PaneOption {
  id: string
  kind: CodeLaunchPresetPaneKind
  adapterId?: string
  title: string
  description: string
  icon: React.ReactNode
}

const createEntry = (
  kind: CodeLaunchPresetPaneKind,
  existingTitles: string[],
  adapterId?: string,
  launchMode: CodeLaunchPresetEntry['agent_launch_mode'] = 'standard',
): CodeLaunchPresetEntry => ({
  id: `preset-entry-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  kind,
  title: nextPetPaneTitle(existingTitles),
  adapter_id: kind === 'coding_agent' ? adapterId ?? null : null,
  url: kind === 'browser' ? DEFAULT_BROWSER_HOME : null,
  agent_launch_mode: kind === 'coding_agent' ? launchMode : 'standard',
})

const paneIcon = (kind: CodeLaunchPresetPaneKind, adapterId: string | null, adapters: CodeAdapterSummary[]) => {
  if (kind === 'coding_agent') {
    const adapter = adapters.find((candidate) => candidate.id === adapterId)
    return adapter ? <CliBrandIcon identifier={adapter.id} size={16} /> : <MonitorPlay size={16} />
  }
  if (kind === 'terminal') return <Terminal size={16} />
  if (kind === 'browser') return <Globe size={16} />
  return <FileText size={16} />
}

const paneTypeName = (kind: CodeLaunchPresetPaneKind): string => {
  if (kind === 'coding_agent') return 'Coding agent'
  if (kind === 'terminal') return 'Terminal'
  if (kind === 'browser') return 'Browser'
  return 'Markdown'
}

export const CodeLayoutPresetLibrary: React.FC<CodeLayoutPresetLibraryProps> = ({ workspaceId, adapters, onOpenPreset, onClose }) => {
  const detectedAdapters = useMemo(() => adapters.filter((adapter) => adapter.detected), [adapters])
  const paneOptions = useMemo<PaneOption[]>(() => [
    ...detectedAdapters.map((adapter) => ({ id: `agent:${adapter.id}`, kind: 'coding_agent' as const, adapterId: adapter.id, title: adapter.display_name, description: 'Command-line coding agent', icon: <CliBrandIcon identifier={adapter.id} size={16} /> })),
    { id: 'terminal', kind: 'terminal' as const, title: 'Terminal', description: 'Interactive local shell', icon: <Terminal size={16} /> },
    { id: 'browser', kind: 'browser' as const, title: 'Browser', description: 'Open Google or a web address', icon: <Globe size={16} /> },
    { id: 'markdown', kind: 'markdown' as const, title: 'Markdown', description: 'Create a Markdown document', icon: <FileText size={16} /> },
  ], [detectedAdapters])
  const [tab, setTab] = useState<'load' | 'create'>('load')
  const [presets, setPresets] = useState<CodeLaunchPresetSummary[]>([])
  const [editing, setEditing] = useState<CodeLaunchPresetSummary | null>(null)
  const [name, setName] = useState('')
  const [entries, setEntries] = useState<CodeLaunchPresetEntry[]>([])
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const groups = useMemo(() => groupPresetEntries(entries), [entries])

  const load = useCallback(async () => {
    try { setPresets(await hiveoryClient.codeLaunchPresets({ workspace_id: workspaceId })) }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'Presets could not be loaded.') }
  }, [workspaceId])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!isPickerOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsPickerOpen(false) }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [isPickerOpen])

  const beginCreate = () => {
    setEditing(null); setName(''); setEntries([]); setExpandedGroups(new Set()); setFeedback(null); setIsPickerOpen(false); setTab('create')
  }

  const startEdit = (preset: CodeLaunchPresetSummary) => {
    setEditing(preset); setName(preset.name); setEntries(structuredClone(preset.entries)); setExpandedGroups(new Set()); setFeedback(null); setIsPickerOpen(false); setTab('create')
  }

  const addPane = (option: PaneOption, launchMode: CodeLaunchPresetEntry['agent_launch_mode'] = 'standard') => {
    setEntries((current) => [...current, createEntry(option.kind, current.map((entry) => entry.title), option.adapterId, launchMode)])
    setFeedback(null); setIsPickerOpen(false)
  }

  const addToGroup = (key: string) => {
    setEntries((current) => {
      const group = groupPresetEntries(current).find((candidate) => candidate.key === key)
      if (!group) return current
      return [...current, createEntry(group.kind, current.map((entry) => entry.title), group.adapterId ?? undefined, group.launchMode)]
    })
    setFeedback(null)
  }

  const removeFromGroup = (key: string) => setEntries((current) => {
    const index = [...current].map(entryGroupKey).lastIndexOf(key)
    return index < 0 ? current : current.filter((_, candidateIndex) => candidateIndex !== index)
  })

  const updateEntryTitle = (id: string, title: string) => {
    setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, title } : entry))
    setFeedback(null)
  }

  const updateBrowserGroupUrl = (key: string, url: string) => {
    setEntries((current) => current.map((entry) => entryGroupKey(entry) === key ? { ...entry, url } : entry))
    setFeedback(null)
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!name.trim()) { setFeedback('Give this preset a name before saving it.'); return }
    if (!entries.length) { setFeedback('Add at least one pane to this preset.'); return }
    if (hasDuplicatePaneTitles(entries)) { setFeedback('Each pane needs a unique name. Rename the highlighted duplicate before saving.'); return }
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

  const isDuplicateTitle = (entry: CodeLaunchPresetEntry) => entries.filter((candidate) => candidate.title.trim().toLocaleLowerCase() === entry.title.trim().toLocaleLowerCase()).length > 1

  return <div className="code-layout-preset-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="code-layout-preset-modal" role="dialog" aria-modal="true" aria-labelledby="code-layout-preset-title" onMouseDown={(event) => event.stopPropagation()}>
      <header className="code-layout-preset-heading"><div><span className="code-dialog-eyebrow">Workspace setup</span><h2 id="code-layout-preset-title">Pane presets</h2></div><button type="button" className="code-pane-action-btn" onClick={onClose} aria-label="Close pane presets"><X size={16} /></button></header>
      <div className="code-layout-preset-tabs" role="tablist" aria-label="Pane preset actions"><button type="button" role="tab" aria-selected={tab === 'load'} className={tab === 'load' ? 'is-active' : ''} onClick={() => { setEditing(null); setFeedback(null); setIsPickerOpen(false); setTab('load') }}><FolderOpen size={14} />Load presets</button><button type="button" role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'is-active' : ''} onClick={beginCreate}><Plus size={14} />Create preset</button></div>
      {tab === 'load' ? <div className="code-layout-preset-list">
        {presets.length ? presets.map((preset) => <article key={preset.id} className="code-layout-preset-row"><span className="code-layout-preset-icon"><LayoutTemplate size={16} /></span><span className="code-layout-preset-copy"><strong>{preset.name}</strong><small>{preset.entries.map((entry) => entry.title).join(' · ')}</small><em>{preset.entries.length} pane{preset.entries.length === 1 ? '' : 's'} ready to open</em></span><span className="code-layout-preset-actions"><button type="button" className="code-secondary-button" onClick={() => startEdit(preset)}><Edit3 size={13} />Edit</button><button type="button" className="code-primary-button" disabled={busy} onClick={() => void open(preset)}><FolderOpen size={13} />Open</button></span></article>) : <div className="code-layout-preset-empty"><LayoutTemplate size={22} /><strong>No saved presets</strong><span>Build a workspace setup once, then open every configured pane together.</span><button type="button" className="code-primary-button" onClick={beginCreate}><Plus size={14} />Create preset</button></div>}
      </div> : <form className="code-layout-preset-form" onSubmit={save}>
        <div><span className="code-dialog-eyebrow">{editing ? 'Edit workspace setup' : 'Build workspace setup'}</span><h3>{editing ? editing.name : 'Create a pane preset'}</h3><p>Add what this workflow needs. Standard and YOLO groups remain separate; quantity controls decide how many panes will open.</p></div>
        <label htmlFor="code-launch-preset-name">Preset name<input id="code-launch-preset-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus placeholder="e.g. Feature review" /></label>
        <div className="code-launch-preset-builder" aria-label="Preset panes">
          {groups.length ? <div className="code-launch-preset-groups">{groups.map((group) => {
            const adapter = detectedAdapters.find((candidate) => candidate.id === group.adapterId)
            const isYolo = group.launchMode === 'yolo'
            const isExpanded = expandedGroups.has(group.key)
            const groupName = adapter?.display_name ?? paneTypeName(group.kind)
            return <article key={group.key} className={`code-launch-preset-group ${isYolo ? 'is-yolo' : ''}`}>
              <div className="code-launch-preset-group-summary">
                <span className="code-launch-preset-entry-icon">{paneIcon(group.kind, group.adapterId, adapters)}</span>
                <span className="code-launch-preset-group-copy"><strong>{groupName}</strong><small>{isYolo ? 'YOLO launch mode' : paneTypeName(group.kind)}</small></span>
                {isYolo && <span className="code-launch-preset-yolo-badge"><Zap size={12} />YOLO</span>}
                <span className="code-launch-preset-stepper" aria-label={`${group.entries.length} ${groupName} panes`}><button type="button" onClick={() => removeFromGroup(group.key)} aria-label={`Remove one ${groupName} pane`}><CircleMinus size={16} /></button><output>{group.entries.length}</output><button type="button" onClick={() => addToGroup(group.key)} aria-label={`Add one ${groupName} pane`}><CirclePlus size={16} /></button></span>
                <button type="button" className="code-launch-preset-names-toggle" onClick={() => setExpandedGroups((current) => { const next = new Set(current); if (next.has(group.key)) next.delete(group.key); else next.add(group.key); return next })} aria-expanded={isExpanded}>{group.entries.length} name{group.entries.length === 1 ? '' : 's'}{isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}</button>
              </div>
              {group.kind === 'browser' && <label className="code-launch-preset-browser-url" htmlFor={`browser-url-${group.entries[0].id}`}>Start URL<input id={`browser-url-${group.entries[0].id}`} value={group.url ?? DEFAULT_BROWSER_HOME} onChange={(event) => updateBrowserGroupUrl(group.key, event.target.value)} placeholder={DEFAULT_BROWSER_HOME} /></label>}
              {isExpanded && <div className="code-launch-preset-name-list">{group.entries.map((entry, index) => <label key={entry.id} htmlFor={`pane-name-${entry.id}`}>Pane {index + 1}<input id={`pane-name-${entry.id}`} value={entry.title} maxLength={80} onChange={(event) => updateEntryTitle(entry.id, event.target.value)} aria-invalid={isDuplicateTitle(entry)} />{isDuplicateTitle(entry) && <span>Use a unique pane name.</span>}</label>)}</div>}
            </article>
          })}</div> : <div className="code-launch-preset-builder-empty"><LayoutTemplate size={20} /><strong>Your preset is empty</strong><span>Add the agents and tools that should open together.</span></div>}
          <div className="code-launch-preset-picker-area">
            <button type="button" className="code-secondary-button code-launch-preset-add-pane" aria-expanded={isPickerOpen} onClick={() => setIsPickerOpen((current) => !current)}><Plus size={15} />Add pane</button>
            {isPickerOpen && <div className="code-launch-preset-picker" role="menu" aria-label="Choose a pane to add"><span className="code-dialog-eyebrow">Choose a pane</span>{paneOptions.map((option) => <div key={option.id} className="code-launch-preset-picker-row"><span className="code-launch-preset-entry-icon">{option.icon}</span><span><strong>{option.title}</strong><small>{option.description}</small></span><span className="code-launch-preset-picker-actions"><button type="button" role="menuitem" onClick={() => addPane(option)}>Standard</button>{option.kind === 'coding_agent' && supportsYoloLaunch(option.adapterId) && <button type="button" role="menuitem" className="is-yolo" onClick={() => addPane(option, 'yolo')}><Zap size={12} />YOLO</button>}</span></div>)}</div>}
          </div>
        </div>
        <div className="code-layout-preset-form-actions"><button type="button" className="code-secondary-button" onClick={() => { setEditing(null); setFeedback(null); setIsPickerOpen(false); setTab('load') }}>Cancel</button><button type="submit" className="code-primary-button" disabled={busy || !name.trim() || entries.length === 0}><Check size={14} />{busy ? 'Saving…' : editing ? 'Save changes' : 'Create preset'}</button></div>
      </form>}
      {feedback && <p className="code-layout-preset-feedback" role="status">{feedback}</p>}
    </section>
  </div>
}
