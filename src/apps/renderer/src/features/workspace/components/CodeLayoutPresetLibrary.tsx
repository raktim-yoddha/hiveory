import React, { useCallback, useEffect, useState } from 'react'
import { Check, Edit3, FolderOpen, LayoutTemplate, Plus, X } from 'lucide-react'
import {
  hiveoryClient,
  type CodeLayoutPresetSummary,
  type CodePaneLayout,
} from '../../../shared/api/hiveory-client'

interface CodeLayoutPresetLibraryProps {
  workspaceId: string
  layout: CodePaneLayout
  onOpenPreset: (presetId: string) => void
  onClose: () => void
}

function paneCount(layout: CodePaneLayout) {
  return layout.nodes.filter((node) => node.children.length === 0).length
}

function formatUpdated(timestamp: number) {
  return new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(timestamp))
}

export const CodeLayoutPresetLibrary: React.FC<CodeLayoutPresetLibraryProps> = ({ workspaceId, layout, onOpenPreset, onClose }) => {
  const [tab, setTab] = useState<'load' | 'create'>('load')
  const [presets, setPresets] = useState<CodeLayoutPresetSummary[]>([])
  const [editing, setEditing] = useState<CodeLayoutPresetSummary | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [replaceLayout, setReplaceLayout] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setPresets(await hiveoryClient.codeLayoutPresets({ workspace_id: workspaceId }))
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Presets could not be loaded.')
    }
  }, [workspaceId])

  useEffect(() => { void load() }, [load])

  const startCreate = () => {
    setEditing(null)
    setName('')
    setDescription('')
    setReplaceLayout(false)
    setFeedback(null)
    setTab('create')
  }

  const startEdit = (preset: CodeLayoutPresetSummary) => {
    setEditing(preset)
    setName(preset.name)
    setDescription(preset.description ?? '')
    setReplaceLayout(false)
    setFeedback(null)
    setTab('create')
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName || busy) return
    setBusy(true)
    setFeedback(null)
    try {
      if (editing) {
        await hiveoryClient.updateCodeLayoutPreset({
          preset_id: editing.id,
          workspace_id: workspaceId,
          name: trimmedName,
          description: description.trim() || null,
          layout: replaceLayout ? layout : null,
        })
        setFeedback('Preset updated.')
      } else {
        await hiveoryClient.createCodeLayoutPreset({
          workspace_id: workspaceId,
          name: trimmedName,
          description: description.trim() || null,
          layout,
        })
        setFeedback('Preset created.')
      }
      await load()
      setTab('load')
      setEditing(null)
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : 'Preset could not be saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="code-layout-preset-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="code-layout-preset-modal" role="dialog" aria-modal="true" aria-labelledby="code-layout-preset-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="code-layout-preset-heading">
          <div><span className="code-dialog-eyebrow">Workspace layout</span><h2 id="code-layout-preset-title">Pane presets</h2></div>
          <button type="button" className="code-pane-action-btn" onClick={onClose} aria-label="Close pane presets"><X size={16} /></button>
        </header>
        <div className="code-layout-preset-tabs" role="tablist" aria-label="Pane preset actions">
          <button type="button" role="tab" aria-selected={tab === 'load'} className={tab === 'load' ? 'is-active' : ''} onClick={() => { setEditing(null); setFeedback(null); setTab('load') }}><FolderOpen size={14} />Load presets</button>
          <button type="button" role="tab" aria-selected={tab === 'create'} className={tab === 'create' ? 'is-active' : ''} onClick={startCreate}><Plus size={14} />Create preset</button>
        </div>

        {tab === 'load' ? <div className="code-layout-preset-list">
          {presets.length ? presets.map((preset) => <article key={preset.id} className="code-layout-preset-row">
            <span className="code-layout-preset-icon"><LayoutTemplate size={16} /></span>
            <span className="code-layout-preset-copy"><strong>{preset.name}</strong><small>{preset.description || 'No description'}</small><em>{preset.pane_count} pane{preset.pane_count === 1 ? '' : 's'} · updated {formatUpdated(preset.updated_at_unix_ms)}</em></span>
            <span className="code-layout-preset-actions"><button type="button" className="code-secondary-button" onClick={() => startEdit(preset)}><Edit3 size={13} />Edit</button><button type="button" className="code-primary-button" onClick={() => { onOpenPreset(preset.id); onClose() }}><FolderOpen size={13} />Open</button></span>
          </article>) : <div className="code-layout-preset-empty"><LayoutTemplate size={22} /><strong>No saved presets</strong><span>Save the current {paneCount(layout)}-pane arrangement from the Create preset tab.</span><button type="button" className="code-primary-button" onClick={startCreate}><Plus size={14} />Create preset</button></div>}
        </div> : <form className="code-layout-preset-form" onSubmit={save}>
          <div><span className="code-dialog-eyebrow">{editing ? 'Edit saved layout' : 'Save current layout'}</span><h3>{editing ? editing.name : 'Create a pane preset'}</h3><p>{editing ? 'Rename this preset or explicitly replace its saved layout with the current workspace arrangement.' : `Save the current ${paneCount(layout)}-pane arrangement for this workspace.`}</p></div>
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} autoFocus placeholder="e.g. Review workspace" /></label>
          <label>Description <span>optional</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} placeholder="What this layout is for" /></label>
          {editing && <label className="code-layout-preset-checkbox"><input type="checkbox" checked={replaceLayout} onChange={(event) => setReplaceLayout(event.target.checked)} /><span>Update this preset from the current workspace layout</span></label>}
          <div className="code-layout-preset-form-actions"><button type="button" className="code-secondary-button" onClick={() => { setEditing(null); setFeedback(null); setTab('load') }}>Cancel</button><button type="submit" className="code-primary-button" disabled={busy || !name.trim()}><Check size={14} />{busy ? 'Saving…' : editing ? 'Save changes' : 'Create preset'}</button></div>
        </form>}
        {feedback && <p className="code-layout-preset-feedback" role="status">{feedback}</p>}
      </section>
    </div>
  )
}
