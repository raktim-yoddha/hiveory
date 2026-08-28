import React, { useEffect, useState } from 'react'
import { CheckCircle2, ChevronRight, Globe, MessageSquare, Terminal, X } from 'lucide-react'
import { agenticSuperAppClient, type CodeAdapterSummary } from '../api/agentic-super-app-client'
import { CliBrandIcon } from './CliIcons'

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
  const [showCliModal, setShowCliModal] = useState(false)
  const [selectedAdapter, setSelectedAdapter] = useState<CodeAdapterSummary | null>(null)
  const [model, setModel] = useState('default')
  const [previewUrl, setPreviewUrl] = useState('http://localhost:3000')
  const [showUrlInput, setShowUrlInput] = useState(false)

  useEffect(() => {
    let mounted = true
    void agenticSuperAppClient.codeSnapshot().then((snapshot) => {
      if (mounted) {
        setAdapters(snapshot.adapters)
        const firstDetected = snapshot.adapters.find((a) => a.detected) || snapshot.adapters[0] || null
        setSelectedAdapter(firstDetected)
      }
    })
    return () => {
      mounted = false
    }
  }, [])

  const handleSelectAndLaunch = (adapter: CodeAdapterSummary) => {
    setSelectedAdapter(adapter)
  }

  const handleConfirmLaunch = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAdapter) return
    onLaunchAgent(selectedAdapter.id, model.trim() === 'default' ? null : model.trim() || null)
    setShowCliModal(false)
  }

  const detectedCount = adapters.filter((a) => a.detected).length

  return (
    <div className="code-empty-pane">
      <div className="code-launcher-container">
        <div className="code-launcher-header">
          <h2>Start a workspace pane</h2>
          <p>Open a shell, coding agent, local preview, or focused thread.</p>
        </div>

        <div className="code-launcher-grid">
          {/* 1. Terminal */}
          <button type="button" className="code-launcher-card" onClick={onLaunchShell}>
            <span className="code-launcher-icon"><Terminal size={17} aria-hidden="true" /></span>
            <span>
              <span className="code-launcher-card-title">Terminal</span>
              <span className="code-launcher-card-desc">Interactive local shell</span>
            </span>
          </button>

          {/* 2. Coding Agent / CLI */}
          <button
            type="button"
            className="code-launcher-card"
            onClick={() => setShowCliModal(true)}
          >
            <span className="code-launcher-icon" style={{ color: '#f59e0b' }}>
              <span style={{ fontSize: 16, fontWeight: 700 }}>✳</span>
            </span>
            <span>
              <span className="code-launcher-card-title">CLI Agent</span>
              <span className="code-launcher-card-desc">
                {detectedCount > 0 ? `${detectedCount} agent${detectedCount > 1 ? 's' : ''} available` : 'Launch coding CLI'}
              </span>
            </span>
          </button>

          {/* 3. Thread */}
          <button type="button" className="code-launcher-card" onClick={onCreateThread}>
            <span className="code-launcher-icon"><MessageSquare size={17} aria-hidden="true" /></span>
            <span>
              <span className="code-launcher-card-title">Thread</span>
              <span className="code-launcher-card-desc">Docked workspace conversation</span>
            </span>
          </button>

          {/* 4. Preview */}
          {showUrlInput ? (
            <form
              className="code-launcher-card code-launcher-url-card"
              onSubmit={(event) => {
                event.preventDefault()
                onOpenPreview(previewUrl)
              }}
            >
              <span className="code-launcher-icon"><Globe size={17} aria-hidden="true" /></span>
              <input
                className="code-preview-url-input"
                value={previewUrl}
                onChange={(event) => setPreviewUrl(event.target.value)}
                placeholder="http://localhost:3000"
                aria-label="Preview URL"
                autoFocus
              />
              <button type="submit" className="code-primary-button">Open</button>
            </form>
          ) : (
            <button type="button" className="code-launcher-card" onClick={() => setShowUrlInput(true)}>
              <span className="code-launcher-icon"><Globe size={17} aria-hidden="true" /></span>
              <span>
                <span className="code-launcher-card-title">Preview</span>
                <span className="code-launcher-card-desc">Open a local web app</span>
              </span>
            </button>
          )}
        </div>
      </div>

      {/* CLI Agent Selection Modal */}
      {showCliModal && (
        <div
          className="code-launch-dialog-backdrop"
          role="presentation"
          onMouseDown={() => setShowCliModal(false)}
        >
          <div
            className="code-cli-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="code-cli-dialog-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="code-cli-dialog-header">
              <div>
                <span className="code-dialog-eyebrow">Command-line Agents</span>
                <h3 id="code-cli-dialog-title">Select Coding Agent</h3>
              </div>
              <button
                type="button"
                className="code-pane-action-btn"
                onClick={() => setShowCliModal(false)}
                aria-label="Close"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>

            <div className="code-cli-list">
              {adapters.map((adapter) => {
                const isSelected = selectedAdapter?.id === adapter.id
                return (
                  <button
                    type="button"
                    key={adapter.id}
                    className={`code-cli-list-item ${isSelected ? 'is-selected' : ''} ${!adapter.detected ? 'is-disabled' : ''}`}
                    disabled={!adapter.detected}
                    onClick={() => handleSelectAndLaunch(adapter)}
                  >
                    <div className="code-cli-item-left">
                      <span className="code-cli-icon">
                        <CliBrandIcon identifier={adapter.id} size={16} />
                      </span>
                      <div className="code-cli-info">
                        <span className="code-cli-name">{adapter.display_name}</span>
                        <span className="code-cli-desc">
                          {adapter.detected ? 'Installed on PATH' : 'Not detected'}
                        </span>
                      </div>
                    </div>
                    <div className="code-cli-item-right">
                      {adapter.detected ? (
                        <span className="code-cli-status-badge ready">
                          <CheckCircle2 size={12} /> Ready
                        </span>
                      ) : (
                        <span className="code-cli-status-badge missing">Not installed</span>
                      )}
                      <ChevronRight size={14} className="code-cli-arrow" />
                    </div>
                  </button>
                )
              })}
            </div>

            {selectedAdapter && (
              <form onSubmit={handleConfirmLaunch} className="code-cli-launch-form">
                <div className="code-cli-model-row">
                  <label htmlFor="code-cli-model-input">Model / Arguments:</label>
                  <input
                    id="code-cli-model-input"
                    className="code-cli-model-input"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="default"
                  />
                </div>
                <div className="code-cli-dialog-footer">
                  <button
                    type="button"
                    className="code-secondary-button"
                    onClick={() => setShowCliModal(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="code-primary-button"
                    disabled={!selectedAdapter.detected}
                  >
                    Launch {selectedAdapter.display_name}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
