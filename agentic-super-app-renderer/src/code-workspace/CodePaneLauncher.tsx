import React, { useEffect, useState } from 'react'
import { Bot, Globe, MessageSquare, Terminal, X } from 'lucide-react'
import { agenticSuperAppClient, type CodeAdapterSummary } from '../api/agentic-super-app-client'

interface CodePaneLauncherProps {
  paneId: string
  onLaunchShell: () => void
  onLaunchAgent: (adapterId: string, model: string | null) => void
  onOpenPreview: (url: string) => void
  onCreateThread: () => void
}

export const CodePaneLauncher: React.FC<CodePaneLauncherProps> = ({
  onLaunchShell,
  onLaunchAgent,
  onOpenPreview,
  onCreateThread,
}) => {
  const [adapters, setAdapters] = useState<CodeAdapterSummary[]>([])
  const [selectedAdapter, setSelectedAdapter] = useState<CodeAdapterSummary | null>(null)
  const [model, setModel] = useState('default')
  const [previewUrl, setPreviewUrl] = useState('http://localhost:3000')
  const [showUrlInput, setShowUrlInput] = useState(false)

  useEffect(() => {
    let mounted = true
    void agenticSuperAppClient.codeSnapshot().then((snapshot) => {
      if (mounted) setAdapters(snapshot.adapters)
    })
    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="code-empty-pane">
      <div className="code-launcher-container">
        <div className="code-launcher-header">
          <h2>Start a workspace pane</h2>
          <p>Open a shell, coding agent, local preview, or focused thread.</p>
        </div>

        <div className="code-launcher-grid">
          <button type="button" className="code-launcher-card" onClick={onLaunchShell}>
            <span className="code-launcher-icon"><Terminal size={17} aria-hidden="true" /></span>
            <span><span className="code-launcher-card-title">Terminal</span><span className="code-launcher-card-desc">Interactive local shell</span></span>
          </button>

          <button type="button" className="code-launcher-card" onClick={onCreateThread}>
            <span className="code-launcher-icon"><MessageSquare size={17} aria-hidden="true" /></span>
            <span><span className="code-launcher-card-title">Thread</span><span className="code-launcher-card-desc">Docked workspace conversation</span></span>
          </button>

          {showUrlInput ? (
            <form className="code-launcher-card code-launcher-url-card" onSubmit={(event) => { event.preventDefault(); onOpenPreview(previewUrl) }}>
              <span className="code-launcher-icon"><Globe size={17} aria-hidden="true" /></span>
              <input className="code-preview-url-input" value={previewUrl} onChange={(event) => setPreviewUrl(event.target.value)} placeholder="http://localhost:3000" aria-label="Preview URL" autoFocus />
              <button type="submit" className="code-primary-button">Open</button>
            </form>
          ) : (
            <button type="button" className="code-launcher-card" onClick={() => setShowUrlInput(true)}>
              <span className="code-launcher-icon"><Globe size={17} aria-hidden="true" /></span>
              <span><span className="code-launcher-card-title">Preview</span><span className="code-launcher-card-desc">Open a local web app</span></span>
            </button>
          )}

          {adapters.map((adapter) => (
            <button type="button" key={adapter.id} className="code-launcher-card" disabled={!adapter.detected} onClick={() => setSelectedAdapter(adapter)}>
              <span className="code-launcher-icon"><Bot size={17} aria-hidden="true" /></span>
              <span><span className="code-launcher-card-title">{adapter.display_name}</span><span className="code-launcher-card-desc">{adapter.detected ? 'Installed command-line agent' : 'Not detected on PATH'}</span></span>
            </button>
          ))}
        </div>
      </div>

      {selectedAdapter && (
        <div className="code-launch-dialog-backdrop" role="presentation" onMouseDown={() => setSelectedAdapter(null)}>
          <form className="code-launch-dialog" role="dialog" aria-modal="true" aria-labelledby="code-launch-dialog-title" onSubmit={(event) => { event.preventDefault(); onLaunchAgent(selectedAdapter.id, model.trim() || null); setSelectedAdapter(null) }} onMouseDown={(event) => event.stopPropagation()}>
            <div className="code-launch-dialog-heading"><div><span className="code-dialog-eyebrow">Coding agent</span><h3 id="code-launch-dialog-title">Launch {selectedAdapter.display_name}</h3></div><button type="button" className="code-pane-btn" onClick={() => setSelectedAdapter(null)} aria-label="Close launch dialog"><X size={15} aria-hidden="true" /></button></div>
            <label className="code-dialog-field"><span>Model</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="default" autoFocus /></label>
            <p className="code-dialog-hint">The agent starts in the selected workspace. Leave the model as “default” to use the CLI’s configured model.</p>
            <div className="code-dialog-actions"><button type="button" className="code-secondary-button" onClick={() => setSelectedAdapter(null)}>Cancel</button><button type="submit" className="code-primary-button"><Bot size={14} aria-hidden="true" />Launch agent</button></div>
          </form>
        </div>
      )}
    </div>
  )
}
