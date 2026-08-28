import React, { useState } from 'react'
import { ArrowUp, Check, ChevronDown, ChevronRight, Zap } from 'lucide-react'

interface CodeThreadPaneProps {
  conversationId?: string
}

export const CodeThreadPane: React.FC<CodeThreadPaneProps> = () => {
  const [inputText, setInputText] = useState('')
  const [showPreviousTools, setShowPreviousTools] = useState(false)

  return (
    <div className="code-thread-container">
      {/* Messages Scroll Area */}
      <div className="code-thread-messages">
        {/* User prompt card */}
        <div className="code-thread-user-bubble">
          Fix the failing checkout test in auth.e2e-spec.ts
        </div>

        {/* Tool calls collapsible block */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            type="button"
            onClick={() => setShowPreviousTools(!showPreviousTools)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#8a8f98',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
              padding: 0,
              textAlign: 'left',
            }}
          >
            {showPreviousTools ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <span>+2 previous tool calls</span>
          </button>

          <div className="code-thread-tool-box">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11 }}>🔲</span>
              <span>
                <strong>Edit</strong> src/auth/auth.service.ts
              </span>
            </div>
            <Check size={14} style={{ color: '#22c55e' }} />
          </div>
        </div>
      </div>

      {/* Composer Input Box */}
      <div className="code-thread-composer-box">
        <div className="code-thread-input-pill">
          <input
            type="text"
            className="code-thread-input"
            placeholder="Ask anything..."
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
          />

          <div className="code-thread-controls-row">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button type="button" className="code-thread-pill-btn">
                <span>⚙</span>
                <span>Automatic · Sonnet 5</span>
                <ChevronDown size={11} />
              </button>
              <button type="button" className="code-thread-pill-btn">
                <Zap size={11} style={{ color: '#f59e0b' }} />
                <span>Low</span>
                <ChevronDown size={11} />
              </button>
            </div>

            <button type="button" className="code-thread-send-btn" title="Send message">
              <ArrowUp size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
