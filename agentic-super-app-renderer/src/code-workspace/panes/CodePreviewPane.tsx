import React, { useState } from 'react'
import { ArrowLeft, ArrowRight, RotateCw, Lock } from 'lucide-react'
import type { CodePreviewSummary } from '../../api/agentic-super-app-client'

interface CodePreviewPaneProps {
  preview?: CodePreviewSummary
  initialUrl?: string
}

export const CodePreviewPane: React.FC<CodePreviewPaneProps> = ({
  preview,
  initialUrl = 'http://localhost:3000/pricing',
}) => {
  const [url, setUrl] = useState(preview?.url || initialUrl)
  const [currentUrl, setCurrentUrl] = useState(preview?.url || initialUrl)
  const [iframeError, setIframeError] = useState(false)

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault()
    let target = url.trim()
    if (!target.startsWith('http://') && !target.startsWith('https://')) {
      target = `http://${target}`
    }
    setCurrentUrl(target)
    setUrl(target)
    setIframeError(false)
  }

  const handleReload = () => {
    setIframeError(false)
  }

  return (
    <div className="code-preview-container">
      {/* Inset Browser Toolbar */}
      <div className="code-preview-toolbar">
        <button type="button" className="code-pane-action-btn" title="Back">
          <ArrowLeft size={13} />
        </button>
        <button type="button" className="code-pane-action-btn" title="Forward">
          <ArrowRight size={13} />
        </button>
        <button type="button" className="code-pane-action-btn" title="Reload" onClick={handleReload}>
          <RotateCw size={12} />
        </button>

        <form onSubmit={handleNavigate} style={{ flex: 1, display: 'flex' }}>
          <div className="code-preview-url-bar">
            <Lock size={10} style={{ opacity: 0.6 }} />
            <input
              type="text"
              value={url.replace(/^https?:\/\//, '')}
              onChange={(e) => setUrl(e.target.value)}
              style={{
                background: 'transparent',
                border: 'none',
                outline: 'none',
                color: '#e5e7eb',
                fontSize: 11,
                width: '100%',
              }}
            />
          </div>
        </form>
      </div>

      {/* Preview Content */}
      {iframeError ? (
        <div
          style={{
            flex: 1,
            background: '#ffffff',
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ height: 16, width: '40%', background: '#e5e7eb', borderRadius: 4 }} />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, flex: 1 }}>
            <div style={{ background: '#f3f4f6', borderRadius: 8, border: '1px solid #e5e7eb' }} />
            <div style={{ background: '#eff6ff', borderRadius: 8, border: '1px solid #bfdbfe' }} />
            <div style={{ background: '#f3f4f6', borderRadius: 8, border: '1px solid #e5e7eb' }} />
          </div>
        </div>
      ) : (
        <iframe
          src={currentUrl}
          className="code-preview-iframe"
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
          title="Local Preview"
          onError={() => setIframeError(true)}
        />
      )}
    </div>
  )
}
