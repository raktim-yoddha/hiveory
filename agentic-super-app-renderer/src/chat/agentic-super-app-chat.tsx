import React, { useState, useRef } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Edit,
  Mic,
  ArrowUp,
  Plus,
  Zap,
  Hammer,
} from 'lucide-react'
import { ClaudeCodeIcon } from '../code-workspace/CliIcons'

interface ChatMessageItem {
  id: string
  role: 'user' | 'assistant'
  content: string
  thoughtTime?: string
}

const DEFAULT_CHAT_MESSAGES: ChatMessageItem[] = [
  {
    id: 'c-1',
    role: 'user',
    content: 'Why would a drag land in the wrong cell when the split tree is correct?',
  },
  {
    id: 'c-2',
    role: 'assistant',
    thoughtTime: 'Thought for 8s',
    content: `Because the drop target is resolved against the frame the pane had when the drag started, not the one it has now.

• The tree is right; the hit test is stale.
• Resolve the frames again on drag move, not on drag begin.

It shows up only after a split, which is why it looked random.`,
  },
]

export function AgenticSuperAppChat() {
  const [messages, setMessages] = useState<ChatMessageItem[]>(DEFAULT_CHAT_MESSAGES)
  const [inputPrompt, setInputPrompt] = useState('')
  const [selectedChatId, setSelectedChatId] = useState('chat-1')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const chatsList = [
    { id: 'chat-new', title: 'New chat', isNew: true },
    { id: 'chat-1', title: 'Why did the pane drag land in...', active: true },
    { id: 'chat-2', title: 'Explain the credit meter to a n...' },
  ]

  const handleSendMessage = () => {
    if (!inputPrompt.trim()) return
    const userMsg: ChatMessageItem = {
      id: `usr-${Date.now()}`,
      role: 'user',
      content: inputPrompt.trim(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInputPrompt('')

    setTimeout(() => {
      const assistantReply: ChatMessageItem = {
        id: `ast-${Date.now()}`,
        role: 'assistant',
        thoughtTime: 'Thought for 3s',
        content: 'I have analyzed the conversation context and prepared a detailed breakdown.',
      }
      setMessages((prev) => [...prev, assistantReply])
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 500)
  }

  return (
    <div className="code-workspace-root chat-mode-root">
      {/* Left Global & Chats Sidebar Rail */}
      <aside className="code-workspace-rail" aria-label="Chat workspace rail">
        <nav className="code-rail-global-nav">
          <button type="button" className="code-rail-nav-item">
            <div className="code-rail-nav-left">
              <span>Dashboard</span>
            </div>
            <span className="code-rail-badge-count">1</span>
          </button>
          <button type="button" className="code-rail-nav-item">
            <div className="code-rail-nav-left">
              <span>Routines</span>
            </div>
          </button>
          <button type="button" className="code-rail-nav-item">
            <div className="code-rail-nav-left">
              <span>Plugins</span>
            </div>
          </button>
          <button type="button" className="code-rail-nav-item">
            <div className="code-rail-nav-left">
              <span>Skills</span>
            </div>
          </button>
        </nav>

        {/* CHATS Section Header */}
        <div className="code-rail-section-header">
          <span>Chats</span>
          <button type="button" className="code-rail-add-btn" title="New Chat">
            <Plus size={14} />
          </button>
        </div>

        {/* Chats List */}
        <div className="code-rail-workspaces-list">
          {chatsList.map((chat) => {
            const isSelected = chat.id === selectedChatId
            return (
              <button
                type="button"
                key={chat.id}
                className={`code-rail-workspace-row ${isSelected ? 'is-active' : ''}`}
                onClick={() => setSelectedChatId(chat.id)}
              >
                <span>{chat.title}</span>
              </button>
            )
          })}
        </div>

        {/* Bottom Sidebar Footer */}
        <footer className="code-rail-footer">
          <div className="code-rail-footer-metric">
            <span>Notch</span>
            <span className="code-rail-toggle-pill">Off</span>
          </div>
          <div className="code-rail-footer-metric">
            <span>Credits</span>
            <span className="code-rail-credits-value">9,684</span>
          </div>
          <div className="code-rail-user-card">
            <div className="code-rail-user-left">
              <div className="code-rail-avatar">B</div>
              <div className="code-rail-user-info">
                <span className="code-rail-username">Bridgemindapps</span>
                <span className="code-rail-user-badge">PRO</span>
              </div>
            </div>
          </div>
        </footer>
      </aside>

      {/* Main Floating Container (Matches Image 4) */}
      <main className="code-workspace-main chat-mode-main">
        {/* Full Chat Conversation Content Pane */}
        <div className="chat-main-content">
          <div className="chat-messages-container">
            <div className="chat-messages-inner">
              {messages.map((msg) => {
                if (msg.role === 'user') {
                  return (
                    <div key={msg.id} className="agent-user-bubble">
                      {msg.content}
                    </div>
                  )
                }

                return (
                  <div key={msg.id} className="agent-assistant-message">
                    {msg.thoughtTime && (
                      <div className="agent-thought-toggle">
                        <ChevronRight size={13} />
                        <span>{msg.thoughtTime}</span>
                      </div>
                    )}

                    <div className="agent-response-text">{msg.content}</div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Floating Bottom Composer Bar (Matches Image 4) */}
          <div className="agent-composer-wrap">
            <div className="agent-floating-composer">
              <input
                type="text"
                className="agent-composer-input"
                placeholder="Ask anything..."
                value={inputPrompt}
                onChange={(e) => setInputPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    handleSendMessage()
                  }
                }}
              />
              <div className="agent-composer-bottom-bar">
                <div className="agent-composer-pills-left">
                  <button type="button" className="agent-composer-pill">
                    <ClaudeCodeIcon size={13} />
                    <span>Claude Code</span>
                    <ChevronDown size={11} />
                  </button>
                  <button type="button" className="agent-composer-pill">
                    <ClaudeCodeIcon size={13} />
                    <span>Automatic · Sonnet 5</span>
                    <ChevronDown size={11} />
                  </button>
                  <button type="button" className="agent-composer-pill">
                    <Zap size={13} style={{ color: '#a855f7' }} />
                    <span>High</span>
                    <ChevronDown size={11} />
                  </button>
                  <button type="button" className="agent-composer-pill">
                    <Edit size={13} />
                    <span>Auto-accept edits</span>
                    <ChevronDown size={11} />
                  </button>
                  <button type="button" className="agent-composer-pill">
                    <Hammer size={13} />
                    <span>Build</span>
                  </button>
                </div>

                <div className="agent-composer-actions-right">
                  <span className="agent-token-count">8.2k tokens</span>
                  <button type="button" className="agent-voice-btn" title="Voice dictation">
                    <Mic size={15} />
                  </button>
                  <button
                    type="button"
                    className="agent-send-btn"
                    onClick={handleSendMessage}
                    disabled={!inputPrompt.trim()}
                    title="Send message"
                  >
                    <ArrowUp size={15} />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
