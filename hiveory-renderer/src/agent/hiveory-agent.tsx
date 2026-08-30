import React, { useState, useRef } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Edit,
  Mic,
  ArrowUp,
  Search,
  Terminal as TerminalIcon,
  FileText,
  CheckCircle2,
  Zap,
  Hammer,
  Plus,
} from 'lucide-react'
import { CliBrandIcon } from '../code-workspace/CliIcons'

interface AgentMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  thoughtTime?: string
  toolCalls?: Array<{
    id: string
    type: 'search' | 'terminal' | 'draft' | 'generic'
    label: string
    completed?: boolean
  }>
}

const DEFAULT_MESSAGES: AgentMessage[] = [
  {
    id: 'msg-1',
    role: 'user',
    content: 'I need you to help me find leads for the launch. Builders shipping with agents, not people talking about them.',
  },
  {
    id: 'msg-2',
    role: 'assistant',
    thoughtTime: 'Thought for 12s',
    toolCalls: [
      { id: 't1', type: 'search', label: 'Search apollo: technographics · ai_coding_tools', completed: true },
      { id: 't2', type: 'terminal', label: 'Run gh api search/commits --jq .items[].author', completed: true },
    ],
    content: `Filtered on evidence rather than vocabulary:

• 412 accounts mention agents in their bio.
• 96 of those shipped a release in the last thirty days.
• 41 did it with a coding agent in the commit trailer.

The 41 are the list. I put the other 371 in a second sheet so you can see what I threw away.`,
  },
  {
    id: 'msg-3',
    role: 'user',
    content: 'Good. Queue the first ten.',
  },
  {
    id: 'msg-4',
    role: 'assistant',
    toolCalls: [
      { id: 't3', type: 'draft', label: 'Draft 10 messages · awaiting approval', completed: true },
    ],
    content: 'Ten drafts held at the gateway.',
  },
]

export function HiveoryAgent() {
  const [selectedAgentId, setSelectedAgentId] = useState<string>('agent-outreach')
  const [activeTab, setActiveTab] = useState<'chats' | 'skills' | 'settings'>('chats')
  const [messages, setMessages] = useState<AgentMessage[]>(DEFAULT_MESSAGES)
  const [inputPrompt, setInputPrompt] = useState('')
  const [selectedThreadId, setSelectedThreadId] = useState('th-2')
  const messagesEndRef = useRef<HTMLDivElement>(null)

  const threads = [
    { id: 'th-1', title: 'hiveory-swift', time: '17m', preview: 'I want you to connect with the f...' },
    { id: 'th-2', title: 'hiveory-swift', time: '20m', preview: 'I need you to help me find lead...' },
  ]

  const agentsList = [
    { id: 'agent-trend', name: 'X trend scout', active: false, hasLiveDot: true },
    { id: 'agent-video', name: 'Trend video strategist', active: false },
    { id: 'agent-charter', name: 'Hiveory charter writer', active: false },
    { id: 'agent-outreach', name: 'Cold outreach operator', active: true, poweredBy: 'Powered by Claude Code' },
  ]

  const handleSendMessage = () => {
    if (!inputPrompt.trim()) return
    const userMsg: AgentMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: inputPrompt.trim(),
    }
    setMessages((prev) => [...prev, userMsg])
    setInputPrompt('')

    // Simulated agent reply for rich UX
    setTimeout(() => {
      const agentReply: AgentMessage = {
        id: `agent-${Date.now()}`,
        role: 'assistant',
        thoughtTime: 'Thought for 4s',
        toolCalls: [
          { id: `tc-${Date.now()}`, type: 'terminal', label: 'Run local analysis routine', completed: true },
        ],
        content: 'Analyzing the workspace context and preparing execution tasks.',
      }
      setMessages((prev) => [...prev, agentReply])
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, 600)
  }

  const selectedAgent = agentsList.find((a) => a.id === selectedAgentId) || agentsList[3]

  return (
    <div className="code-workspace-root agent-mode-root">
      {/* Left Global & Agents Sidebar Rail */}
      <aside className="code-workspace-rail" aria-label="Agent workspace rail">
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

        {/* AGENTS Section Header */}
        <div className="code-rail-section-header">
          <span>Agents</span>
          <button type="button" className="code-rail-add-btn" title="Create Agent">
            <Plus size={14} />
          </button>
        </div>

        {/* Agents List */}
        <div className="code-rail-workspaces-list">
          {agentsList.map((agent) => {
            const isSelected = agent.id === selectedAgentId
            return (
              <button
                type="button"
                key={agent.id}
                className={`code-rail-workspace-row ${isSelected ? 'is-active' : ''}`}
                onClick={() => setSelectedAgentId(agent.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                  <span>{agent.name}</span>
                  {agent.hasLiveDot && <span className="code-live-dot" />}
                </div>
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

      {/* Main Floating Container (Matches Image 3) */}
      <main className="code-workspace-main agent-mode-main">
        {/* Left Sub-Sidebar: Chats Thread List */}
        <aside className="agent-sub-sidebar">
          <div className="agent-sub-header">
            <span>Chats</span>
            <button type="button" className="agent-sub-icon-btn" title="Edit / Compose">
              <Edit size={14} />
            </button>
          </div>
          <div className="agent-thread-list">
            {threads.map((thread) => {
              const isSelected = thread.id === selectedThreadId
              return (
                <button
                  type="button"
                  key={thread.id}
                  className={`agent-thread-card ${isSelected ? 'is-active' : ''}`}
                  onClick={() => setSelectedThreadId(thread.id)}
                >
                  <div className="agent-thread-top">
                    <span className="agent-thread-title">{thread.title}</span>
                    <span className="agent-thread-time">{thread.time}</span>
                  </div>
                  <div className="agent-thread-preview">{thread.preview}</div>
                </button>
              )
            })}
          </div>
        </aside>

        {/* Right Main Content Pane */}
        <div className="agent-main-content">
          {/* Top Content Bar */}
          <div className="agent-content-header">
            <div className="agent-info-left">
              <div className="agent-icon-box">
                <CliBrandIcon identifier="claude-code" size={16} />
              </div>
              <div className="agent-heading-text">
                <h2>{selectedAgent.name}</h2>
                <span className="agent-powered-by">Powered by Claude Code</span>
              </div>
            </div>

            <div className="agent-header-controls">
              <span className="agent-working-pill">• 0 working</span>
              <div className="agent-header-tabs">
                <button
                  type="button"
                  className={`agent-tab-pill ${activeTab === 'chats' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('chats')}
                >
                  Chats
                </button>
                <button
                  type="button"
                  className={`agent-tab-pill ${activeTab === 'skills' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('skills')}
                >
                  Skills <span className="agent-tab-count">2</span>
                </button>
                <button
                  type="button"
                  className={`agent-tab-pill ${activeTab === 'settings' ? 'is-active' : ''}`}
                  onClick={() => setActiveTab('settings')}
                >
                  Settings
                </button>
              </div>
              <button type="button" className="agent-new-chat-btn">
                <span>New chat</span>
                <ChevronDown size={13} />
              </button>
            </div>
          </div>

          {/* Messages Stream */}
          <div className="agent-messages-container">
            <div className="agent-messages-inner">
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

                    {msg.toolCalls && msg.toolCalls.length > 0 && (
                      <div className="agent-tools-timeline">
                        <span className="agent-tools-expand">+2 previous tool calls</span>
                        {msg.toolCalls.map((tool) => (
                          <div key={tool.id} className="agent-tool-item">
                            <div className="agent-tool-left">
                              {tool.type === 'search' && <Search size={13} />}
                              {tool.type === 'terminal' && <TerminalIcon size={13} />}
                              {tool.type === 'draft' && <FileText size={13} />}
                              <span>{tool.label}</span>
                            </div>
                            <CheckCircle2 size={13} className="agent-tool-check" />
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="agent-response-text">{msg.content}</div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* Floating Bottom Composer Bar (Matches Image 3) */}
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
                    <CliBrandIcon identifier="claude-code" size={13} />
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
                  <span className="agent-token-count">31.6k tokens</span>
                  <button type="button" className="agent-voice-btn" title="Voice dictation">
                    <Mic size={15} />
                  </button>
                  <button
                    type="button"
                    className="agent-send-btn"
                    onClick={handleSendMessage}
                    disabled={!inputPrompt.trim()}
                    title="Send prompt"
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
