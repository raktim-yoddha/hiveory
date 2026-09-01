import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit,
  FileText,
  Hammer,
  Mic,
  Plus,
  Search,
  Square,
  Terminal as TerminalIcon,
  Zap,
} from 'lucide-react'
import { CliBrandIcon } from '../code-workspace/CliIcons'
import { HiveoryPlugins } from '../automation/hiveory-plugins'
import { HiveoryRoutines } from '../automation/hiveory-routines'
import {
  hiveoryClient,
  type AgentApprovalPolicy,
  type AgentConversationDetail,
  type AgentConversationSummary,
  type AgentDetail,
  type AgentExecutionTarget,
  type AgentEventEnvelope,
  type AgentMessage,
  type AgentRunDetail,
  type AgentSummary,
} from '../api/hiveory-client'

/** The first durable Agent Mode release. Kept separate from the host app version. */
export const AGENT_MODE_VERSION = '0.1.0'

type AgentTab = 'chats' | 'skills' | 'settings'
type AgentSection = 'agents' | 'dashboard' | 'routines' | 'plugins'

const DEFAULT_LIMITS = {
  max_steps: 24,
  max_tool_calls: 32,
  max_duration_seconds: 1800,
  max_context_tokens: 128000,
  max_subagent_depth: 2,
  max_concurrent_subagents: 2,
}

function relativeTime(timestamp: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000))
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

function payload(event: AgentEventEnvelope): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(event.payload)
    return value && typeof value === 'object' ? value as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function eventText(event: AgentEventEnvelope) {
  const value = payload(event).text
  return typeof value === 'string' ? value : ''
}

function isTerminal(state: string | undefined) {
  return state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'interrupted'
}

function messagePreview(messages: AgentMessage[]) {
  return messages.find((message) => message.role === 'user')?.content.slice(0, 52) ?? 'New conversation'
}

function toolIcon(name: string) {
  if (name.includes('search')) return <Search size={13} />
  if (name.includes('artifact') || name.includes('write')) return <FileText size={13} />
  return <TerminalIcon size={13} />
}

export function HiveoryAgent() {
  const [section, setSection] = useState<AgentSection>('agents')
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<AgentTab>('chats')
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [agent, setAgent] = useState<AgentDetail | null>(null)
  const [threads, setThreads] = useState<AgentConversationSummary[]>([])
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [conversation, setConversation] = useState<AgentConversationDetail | null>(null)
  const [activeRun, setActiveRun] = useState<AgentRunDetail | null>(null)
  const [streamingText, setStreamingText] = useState('')
  const [inputPrompt, setInputPrompt] = useState('')
  const [executionTarget, setExecutionTarget] = useState<AgentExecutionTarget>('desktop')
  const [remoteTarget, setRemoteTarget] = useState('')
  const [modelDraft, setModelDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const eventCursorRef = useRef(0)

  const loadAgents = useCallback(async () => {
    setLoading(true)
    try {
      const loaded = (await hiveoryClient.agents()).filter((item) => !item.archived)
      setAgents(loaded)
      setSelectedAgentId((current) => current && loaded.some((item) => item.id === current) ? current : loaded[0]?.id ?? null)
      setError(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Agent Mode could not load agents.')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadAgent = useCallback(async (agentId: string) => {
    try {
      const [detail, conversations] = await Promise.all([
        hiveoryClient.agent(agentId),
        hiveoryClient.agentConversations({ agent_id: agentId, limit: 100 }),
      ])
      setAgent(detail)
      setThreads(conversations)
      setSelectedThreadId((current) => current && conversations.some((item) => item.id === current) ? current : conversations[0]?.id ?? null)
      setError(null)
      try {
        const storedTarget = window.localStorage.getItem(`hiveory.agent-target.${agentId}`)
        setExecutionTarget(storedTarget === 'remote_vm' ? 'remote_vm' : 'desktop')
        setRemoteTarget(window.localStorage.getItem(`hiveory.agent-remote-target.${agentId}`) ?? '')
      } catch {
        setExecutionTarget('desktop')
        setRemoteTarget('')
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Agent details could not be loaded.')
    }
  }, [])

  const loadConversation = useCallback(async (conversationId: string) => {
    try {
      const detail = await hiveoryClient.agentConversation(conversationId)
      setConversation(detail)
      const latestRun = detail.runs.find((run) => !isTerminal(run.state)) ?? detail.runs[0]
      if (latestRun) {
        const run = await hiveoryClient.agentRun(latestRun.id)
        setActiveRun(run)
        eventCursorRef.current = run.event_cursor
      } else {
        setActiveRun(null)
        eventCursorRef.current = 0
      }
      setStreamingText('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Conversation could not be loaded.')
    }
  }, [])

  useEffect(() => { void loadAgents() }, [loadAgents])
  useEffect(() => {
    if (!selectedAgentId) {
      setAgent(null)
      setThreads([])
      setConversation(null)
      return
    }
    void loadAgent(selectedAgentId)
  }, [loadAgent, selectedAgentId])
  useEffect(() => { setModelDraft(agent?.summary.model ?? '') }, [agent?.summary.id, agent?.summary.model])
  useEffect(() => {
    if (!selectedThreadId) {
      setConversation(null)
      setActiveRun(null)
      return
    }
    void loadConversation(selectedThreadId)
  }, [loadConversation, selectedThreadId])
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [conversation?.messages.length, streamingText])

  useEffect(() => {
    if (!activeRun || isTerminal(activeRun.summary.state)) return
    const runId = activeRun.summary.id
    const conversationId = activeRun.summary.conversation_id
    const agentId = activeRun.summary.agent_id
    return hiveoryClient.subscribeAgent(runId, (event) => {
      if (event.sequence <= eventCursorRef.current) return
      eventCursorRef.current = event.sequence
      if (event.kind === 'assistant_text_delta') setStreamingText((current) => current + eventText(event))
      if (event.kind === 'tool_call_proposed' || event.kind === 'tool_call_started' || event.kind === 'tool_call_completed' || event.kind === 'approval_requested' || event.kind === 'input_requested') {
        void hiveoryClient.agentRun(runId).then(setActiveRun).catch(() => undefined)
      }
      if (event.kind === 'run_state_changed') {
        const state = payload(event).state
        if (typeof state === 'string' && isTerminal(state)) {
          void loadConversation(conversationId)
          void loadAgent(agentId)
          void loadAgents()
        } else {
          void hiveoryClient.agentRun(runId).then(setActiveRun).catch(() => undefined)
        }
      }
    }, eventCursorRef.current)
  // A live stream has no Tauri-side unsubscribe primitive. Key this effect only by
  // the run id so refreshes of its detail never open duplicate subscriptions.
  }, [activeRun?.summary.id, loadAgent, loadAgents, loadConversation])

  const selectedAgent = useMemo(() => agents.find((item) => item.id === selectedAgentId) ?? null, [agents, selectedAgentId])
  const pendingApprovals = activeRun?.approvals.filter((approval) => approval.state === 'pending') ?? []
  const runIsActive = Boolean(activeRun && !isTerminal(activeRun.summary.state))

  const createAgent = async () => {
    setSending(true)
    try {
      const diagnostics = await hiveoryClient.diagnostics()
      const provider = diagnostics.providers.find((item) => item.enabled) ?? diagnostics.providers[0]
      if (!provider) throw new Error('Configure a model provider before creating an agent.')
      const detail = await hiveoryClient.createAgent({
        name: 'New agent',
        description: 'A local-first agent with explicit approvals.',
        operating_brief: 'Work only inside explicitly granted scopes. Explain material actions before taking them.',
        avatar_color: '#22d3ee',
        provider_account_id: provider.id,
        model: provider.default_model ?? 'default',
        system_instructions: 'You are a careful local-first agent. Ask before mutations or external actions.',
        approval_policy: 'ask_for_mutations',
        memory_policy: 'explicit_only',
        runtime_limits: DEFAULT_LIMITS,
      })
      setAgents((current) => [...current, detail.summary])
      setSelectedAgentId(detail.summary.id)
      setSection('agents')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Agent could not be created.')
    } finally {
      setSending(false)
    }
  }

  const createConversation = async () => {
    if (!selectedAgentId) return
    try {
      const created = await hiveoryClient.createAgentConversation({ agent_id: selectedAgentId, title: null })
      setThreads((current) => [{ id: created.id, agent_id: created.agent_id, title: created.title, message_count: 0, updated_at_unix_ms: created.updated_at_unix_ms }, ...current])
      setSelectedThreadId(created.id)
      setActiveTab('chats')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Conversation could not be created.')
    }
  }

  const handleSendMessage = async () => {
    const prompt = inputPrompt.trim()
    if (!prompt || !selectedAgentId || sending || runIsActive) return
    if (executionTarget === 'remote_vm' && !remoteTarget.trim()) {
      setError('Enter an SSH host alias or user@host in Agent settings before starting a Remote VM run.')
      return
    }
    setSending(true)
    try {
      let conversationId = selectedThreadId
      if (!conversationId) {
        const created = await hiveoryClient.createAgentConversation({ agent_id: selectedAgentId, title: prompt.slice(0, 48) })
        conversationId = created.id
        setSelectedThreadId(created.id)
      }
      const run = await hiveoryClient.startAgentRun({ agent_id: selectedAgentId, conversation_id: conversationId, prompt, background: false, execution_target: executionTarget, remote_target: executionTarget === 'remote_vm' ? remoteTarget.trim() : null })
      setInputPrompt('')
      setStreamingText('')
      const detail = await hiveoryClient.agentRun(run.id)
      setActiveRun(detail)
      eventCursorRef.current = detail.event_cursor
      await loadConversation(conversationId)
      await loadAgent(selectedAgentId)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Agent run could not be started.')
    } finally {
      setSending(false)
    }
  }

  const cancelRun = async () => {
    if (!activeRun) return
    try {
      await hiveoryClient.cancelAgentRun({ run_id: activeRun.summary.id })
      await loadConversation(activeRun.summary.conversation_id)
      await loadAgent(activeRun.summary.agent_id)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Agent run could not be cancelled.')
    }
  }

  const decideApproval = async (approvalId: string, decision: 'approve' | 'deny') => {
    if (!activeRun) return
    const approval = activeRun.approvals.find((item) => item.id === approvalId)
    if (!approval) return
    try {
      const summary = await hiveoryClient.decideAgentApproval({ run_id: activeRun.summary.id, approval_id: approval.id, fingerprint: approval.fingerprint, decision, comment: null })
      setActiveRun(await hiveoryClient.agentRun(summary.id))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Approval could not be recorded.')
    }
  }

  const toggleSkill = async (skillId: string, enabled: boolean) => {
    if (!selectedAgentId) return
    try {
      setAgent(await hiveoryClient.toggleAgentSkill({ agent_id: selectedAgentId, skill_id: skillId, enabled }))
      await loadAgents()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Skill setting could not be changed.')
    }
  }

  const setApprovalPolicy = async (approvalPolicy: AgentApprovalPolicy) => {
    if (!agent) return
    try {
      const detail = await hiveoryClient.updateAgent({ agent_id: agent.summary.id, name: agent.summary.name, description: agent.summary.description, operating_brief: agent.operating_brief, avatar_color: agent.summary.avatar_color, provider_account_id: agent.summary.provider_account_id, model: agent.summary.model, system_instructions: agent.system_instructions, approval_policy: approvalPolicy, memory_policy: agent.memory_policy, runtime_limits: agent.runtime_limits })
      setAgent(detail)
      await loadAgents()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Approval policy could not be saved.')
    }
  }

  const saveModel = async () => {
    if (!agent) return
    const model = modelDraft.trim()
    if (!model || model === agent.summary.model) return
    try {
      const detail = await hiveoryClient.updateAgent({
        agent_id: agent.summary.id,
        name: agent.summary.name,
        description: agent.summary.description,
        operating_brief: agent.operating_brief,
        avatar_color: agent.summary.avatar_color,
        provider_account_id: agent.summary.provider_account_id,
        model,
        system_instructions: agent.system_instructions,
        approval_policy: agent.approval_policy,
        memory_policy: agent.memory_policy,
        runtime_limits: agent.runtime_limits,
      })
      setAgent(detail)
      await loadAgents()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Model could not be saved.')
    }
  }

  const selectTarget = (target: AgentExecutionTarget) => {
    setExecutionTarget(target)
    if (!selectedAgentId) return
    try { window.localStorage.setItem(`hiveory.agent-target.${selectedAgentId}`, target) } catch { /* browser storage is optional */ }
  }

  const saveRemoteTarget = (target: string) => {
    setRemoteTarget(target)
    if (!selectedAgentId) return
    try { window.localStorage.setItem(`hiveory.agent-remote-target.${selectedAgentId}`, target) } catch { /* browser storage is optional */ }
  }

  const renderMessage = (message: AgentMessage) => message.role === 'user'
    ? <div key={message.id} className="agent-user-bubble">{message.content}</div>
    : <div key={message.id} className="agent-assistant-message"><div className="agent-response-text">{message.content}</div></div>

  const mainContent = section === 'dashboard'
    ? <div className="agent-messages-container"><div className="agent-messages-inner"><h3>Agent dashboard</h3><p>{agents.length} active agents · {agents.filter((item) => item.active_run_state).length} working</p>{agents.map((item) => <div className="agent-tool-item" key={item.id}><div className="agent-tool-left"><span className="code-live-dot" style={{ background: item.avatar_color }} /><span>{item.name}</span></div><span>{item.active_run_state?.replaceAll('_', ' ') ?? 'ready'}</span></div>)}</div></div>
    : section === 'routines'
      ? <HiveoryRoutines />
      : section === 'plugins'
        ? <HiveoryPlugins />
        : <>
          <div className="agent-messages-container"><div className="agent-messages-inner">
            {error && <div className="agent-tool-item" role="alert"><div className="agent-tool-left"><span>{error}</span></div></div>}
            {activeTab === 'skills' && agent?.skills.map((skill) => <div className="agent-tool-item" key={skill.id}><div className="agent-tool-left"><FileText size={13} /><span><strong>{skill.name}</strong> · {skill.description}</span></div><button type="button" className="agent-composer-pill" onClick={() => void toggleSkill(skill.id, !skill.enabled)}>{skill.enabled ? 'Enabled' : 'Enable'}</button></div>)}
            {activeTab === 'settings' && agent && <><div className="agent-tool-item"><div className="agent-tool-left"><span>Agent Mode runtime</span></div><span>v{AGENT_MODE_VERSION}</span></div><div className="agent-tool-item"><div className="agent-tool-left"><span>Provider</span></div><span>{agent.summary.provider_account_id}</span></div><label className="agent-tool-item"><div className="agent-tool-left"><span>Model</span></div><input value={modelDraft} onChange={(event) => setModelDraft(event.target.value)} onBlur={() => void saveModel()} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); void saveModel() } }} aria-label="Agent model" /></label><label className="agent-tool-item"><div className="agent-tool-left"><span>Approval policy</span></div><select value={agent.approval_policy} onChange={(event) => void setApprovalPolicy(event.target.value as AgentApprovalPolicy)}><option value="always_ask">Always ask</option><option value="ask_for_mutations">Ask for mutations</option><option value="allow_within_scope">Allow in scope</option><option value="deny">Deny tools</option></select></label><div className="agent-tool-item"><div className="agent-tool-left"><span>Execution face</span></div><span>{executionTarget === 'desktop' ? 'Windows desktop' : 'Remote VM'}</span></div>{executionTarget === 'remote_vm' && <label className="agent-tool-item"><div className="agent-tool-left"><TerminalIcon size={13} /><span>SSH target</span></div><input value={remoteTarget} placeholder="dev-vm or user@host" onChange={(event) => saveRemoteTarget(event.target.value)} aria-label="Remote VM SSH target" /></label>}<div className="agent-tool-item"><div className="agent-tool-left"><span>Execution safety</span></div><span>Commands always require approval</span></div></>}
            {activeTab === 'chats' && <>{!conversation && !loading && <div className="agent-assistant-message"><div className="agent-response-text">Start a new chat to give this agent a task.</div></div>}{conversation?.messages.map(renderMessage)}{streamingText && <div className="agent-assistant-message"><div className="agent-thought-toggle"><ChevronRight size={13} /><span>Working</span></div><div className="agent-response-text">{streamingText}</div></div>}{activeRun?.tool_calls.length ? <div className="agent-tools-timeline">{activeRun.tool_calls.map((tool) => <div className="agent-tool-item" key={tool.id}><div className="agent-tool-left">{toolIcon(tool.name)}<span>{tool.name}</span></div>{tool.state === 'completed' ? <CheckCircle2 size={13} className="agent-tool-check" /> : <span>{tool.state.replaceAll('_', ' ')}</span>}</div>)}</div> : null}{pendingApprovals.map((approval) => <div key={approval.id} className="agent-tools-timeline"><div className="agent-tool-item"><div className="agent-tool-left"><Hammer size={13} /><span>{approval.tool_name}: {approval.target}</span></div><div className="agent-composer-pills-left"><button type="button" className="agent-composer-pill" onClick={() => void decideApproval(approval.id, 'deny')}>Deny</button><button type="button" className="agent-send-btn" onClick={() => void decideApproval(approval.id, 'approve')}>Allow</button></div></div></div>)}</>}
            <div ref={messagesEndRef} />
          </div></div>
          {section === 'agents' && activeTab === 'chats' && <div className="agent-composer-wrap"><div className="agent-floating-composer"><input type="text" className="agent-composer-input" placeholder={runIsActive ? 'Agent is working…' : 'Ask anything…'} value={inputPrompt} disabled={runIsActive} onChange={(event) => setInputPrompt(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleSendMessage() } }} /><div className="agent-composer-bottom-bar"><div className="agent-composer-pills-left"><button type="button" className="agent-composer-pill" onClick={() => setActiveTab('settings')} title="Edit model in Agent settings"><CliBrandIcon identifier={agent?.summary.provider_account_id ?? 'openai'} size={13} /><span>{agent?.summary.model ?? 'Automatic'}</span><ChevronDown size={11} /></button><button type="button" className="agent-composer-pill" disabled title="Reasoning effort is fixed by the configured model"><Zap size={13} style={{ color: '#a855f7' }} /><span>Model default</span></button><button type="button" className="agent-composer-pill" onClick={() => setActiveTab('settings')} title="Edit approval policy in Agent settings"><Edit size={13} /><span>{agent?.approval_policy === 'always_ask' ? 'Ask first' : 'Scoped approvals'}</span></button><button type="button" className="agent-composer-pill" disabled={runIsActive} onClick={() => selectTarget(executionTarget === 'desktop' ? 'remote_vm' : 'desktop')} title={runIsActive ? 'Execution face is locked while a run is active' : 'Select execution face for the next run'}><Hammer size={13} /><span>{executionTarget === 'desktop' ? 'Desktop' : 'Remote VM'}</span></button></div><div className="agent-composer-actions-right"><span className="agent-token-count">{activeRun?.summary.input_tokens ?? 0} tokens</span><button type="button" className="agent-voice-btn" disabled title="Voice dictation is not configured yet"><Mic size={15} /></button>{runIsActive ? <button type="button" className="agent-send-btn" onClick={() => void cancelRun()} title="Stop agent"><Square size={13} /></button> : <button type="button" className="agent-send-btn" onClick={() => void handleSendMessage()} disabled={!inputPrompt.trim() || sending} title="Send prompt"><ArrowUp size={15} /></button>}</div></div></div></div>}
        </>

  return <div className="code-workspace-root agent-mode-root">
    <aside className="code-workspace-rail" aria-label="Agent workspace rail">
      <nav className="code-rail-global-nav">
        <button type="button" className="code-rail-nav-item" onClick={() => setSection('dashboard')}><div className="code-rail-nav-left"><span>Dashboard</span></div><span className="code-rail-badge-count">{agents.filter((item) => item.active_run_state).length}</span></button>
        <button type="button" className="code-rail-nav-item" onClick={() => setSection('routines')}><div className="code-rail-nav-left"><span>Routines</span></div></button>
        <button type="button" className="code-rail-nav-item" onClick={() => setSection('plugins')}><div className="code-rail-nav-left"><span>Plugins</span></div></button>
        <button type="button" className="code-rail-nav-item" onClick={() => { setSection('agents'); setActiveTab('skills') }}><div className="code-rail-nav-left"><span>Skills</span></div></button>
      </nav>
      <div className="code-rail-section-header"><span>Agents</span><button type="button" className="code-rail-add-btn" title="Create agent" disabled={sending} onClick={() => void createAgent()}><Plus size={14} /></button></div>
      <div className="code-rail-workspaces-list">{agents.map((item) => <button type="button" key={item.id} className={`code-rail-workspace-row ${item.id === selectedAgentId && section === 'agents' ? 'is-active' : ''}`} onClick={() => { setSection('agents'); setSelectedAgentId(item.id); setActiveTab('chats') }}><div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}><span>{item.name}</span>{item.active_run_state && <span className="code-live-dot" />}</div></button>)}{!loading && agents.length === 0 && <span className="agent-thread-preview">Create your first agent.</span>}</div>
      <footer className="code-rail-footer"><div className="code-rail-footer-metric"><span>Runtime</span><span className="code-rail-toggle-pill">v{AGENT_MODE_VERSION}</span></div><div className="code-rail-footer-metric"><span>Mode</span><span className="code-rail-credits-value">Local-first</span></div></footer>
    </aside>
    <main className="code-workspace-main agent-mode-main">
      <aside className="agent-sub-sidebar"><div className="agent-sub-header"><span>Chats</span><button type="button" className="agent-sub-icon-btn" title="New chat" onClick={() => void createConversation()} disabled={!selectedAgentId}><Edit size={14} /></button></div><div className="agent-thread-list">{threads.map((thread) => <button type="button" key={thread.id} className={`agent-thread-card ${thread.id === selectedThreadId ? 'is-active' : ''}`} onClick={() => setSelectedThreadId(thread.id)}><div className="agent-thread-top"><span className="agent-thread-title">{thread.title}</span><span className="agent-thread-time">{relativeTime(thread.updated_at_unix_ms)}</span></div><div className="agent-thread-preview">{conversation?.id === thread.id ? messagePreview(conversation.messages) : `${thread.message_count} messages`}</div></button>)}</div></aside>
      <div className="agent-main-content"><div className="agent-content-header"><div className="agent-info-left"><div className="agent-icon-box"><CliBrandIcon identifier={selectedAgent?.provider_account_id ?? 'openai'} size={16} /></div><div className="agent-heading-text"><h2>{selectedAgent?.name ?? 'Agent Mode'}</h2><span className="agent-powered-by">{selectedAgent ? `Powered by ${selectedAgent.provider_account_id}` : 'Create an agent to begin'}</span></div></div><div className="agent-header-controls"><span className="agent-working-pill">• {agents.filter((item) => item.active_run_state).length} working</span><div className="agent-header-tabs"><button type="button" className={`agent-tab-pill ${activeTab === 'chats' ? 'is-active' : ''}`} onClick={() => setActiveTab('chats')}>Chats</button><button type="button" className={`agent-tab-pill ${activeTab === 'skills' ? 'is-active' : ''}`} onClick={() => setActiveTab('skills')}>Skills <span className="agent-tab-count">{agent?.skills.filter((skill) => skill.enabled).length ?? 0}</span></button><button type="button" className={`agent-tab-pill ${activeTab === 'settings' ? 'is-active' : ''}`} onClick={() => setActiveTab('settings')}>Settings</button></div><button type="button" className="agent-new-chat-btn" onClick={() => void createConversation()} disabled={!selectedAgentId}><span>New chat</span><ChevronDown size={13} /></button></div></div>{mainContent}</div>
    </main>
  </div>
}
