import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Bot, Check, Loader2, MessageSquarePlus, Send, X } from 'lucide-react'
import {
  hiveoryClient,
  type AgentConversationSummary,
  type AgentSummary,
} from '../../../shared/api/hiveory-client'

interface BrowserAgentDeliveryProps {
  prompt: string
  onCancel: () => void
  onDelivered: (message: string) => void
  onError: (message: string) => void
}

export function BrowserAgentDelivery({ prompt, onCancel, onDelivered, onError }: BrowserAgentDeliveryProps) {
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<AgentConversationSummary[]>([])
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)

  useEffect(() => {
    let disposed = false
    void hiveoryClient.agents().then((items) => {
      if (disposed) return
      const available = items.filter((agent) => !agent.archived)
      setAgents(available)
      setSelectedAgentId(available[0]?.id ?? null)
    }).catch((error: unknown) => {
      if (!disposed) onError(error instanceof Error ? error.message : 'Agent destinations could not be loaded.')
    }).finally(() => {
      if (!disposed) setLoading(false)
    })
    return () => { disposed = true }
  }, [onError])

  useEffect(() => {
    if (!selectedAgentId) {
      setConversations([])
      setSelectedConversationId(null)
      return
    }
    let disposed = false
    setLoading(true)
    setSelectedConversationId(null)
    void hiveoryClient.agentConversations({ agent_id: selectedAgentId, limit: 20 }).then((items) => {
      if (!disposed) setConversations(items)
    }).catch((error: unknown) => {
      if (!disposed) onError(error instanceof Error ? error.message : 'Agent conversations could not be loaded.')
    }).finally(() => {
      if (!disposed) setLoading(false)
    })
    return () => { disposed = true }
  }, [onError, selectedAgentId])

  const selectedAgent = useMemo(() => agents.find((agent) => agent.id === selectedAgentId) ?? null, [agents, selectedAgentId])

  const deliver = async () => {
    if (!selectedAgent) return
    setSending(true)
    try {
      let conversationId = selectedConversationId
      if (!conversationId) {
        const created = await hiveoryClient.createAgentConversation({ agent_id: selectedAgent.id, title: 'Browser feedback' })
        conversationId = created.id
      }
      await hiveoryClient.startAgentRun({
        agent_id: selectedAgent.id,
        conversation_id: conversationId,
        prompt,
        background: false,
      })
      onDelivered(`Browser feedback sent to ${selectedAgent.name}.`)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Browser feedback could not be sent.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="hiveory-browser-agent-delivery" role="dialog" aria-modal="true" aria-labelledby="browser-agent-delivery-title">
      <div className="hiveory-browser-agent-delivery-header">
        <div>
          <span>Browser annotations</span>
          <strong id="browser-agent-delivery-title">Send feedback to an agent</strong>
        </div>
        <button type="button" onClick={onCancel} aria-label="Close agent selection"><X size={15} /></button>
      </div>
      <div className="hiveory-browser-agent-delivery-body">
        <section aria-label="Agents">
          <div className="hiveory-browser-agent-delivery-label"><Bot size={13} /> Agent</div>
          <div className="hiveory-browser-agent-delivery-list">
            {agents.map((agent) => (
              <button type="button" key={agent.id} className={agent.id === selectedAgentId ? 'is-selected' : ''} onClick={() => setSelectedAgentId(agent.id)}>
                <span className="hiveory-browser-agent-dot" style={{ background: agent.avatar_color }} />
                <span><strong>{agent.name}</strong><small>{agent.model}</small></span>
                {agent.id === selectedAgentId && <Check size={14} />}
              </button>
            ))}
            {!loading && agents.length === 0 && <p>No configured agents are available.</p>}
          </div>
        </section>
        <section aria-label="Agent conversations">
          <div className="hiveory-browser-agent-delivery-label"><MessageSquarePlus size={13} /> Conversation</div>
          <div className="hiveory-browser-agent-delivery-list">
            <button type="button" className={selectedConversationId === null ? 'is-selected' : ''} onClick={() => setSelectedConversationId(null)} disabled={!selectedAgentId}>
              <span><strong>New conversation</strong><small>Start with this browser feedback</small></span>
              {selectedConversationId === null && <Check size={14} />}
            </button>
            {conversations.map((conversation) => (
              <button type="button" key={conversation.id} className={conversation.id === selectedConversationId ? 'is-selected' : ''} onClick={() => setSelectedConversationId(conversation.id)}>
                <span><strong>{conversation.title}</strong><small>{conversation.message_count} messages</small></span>
                {conversation.id === selectedConversationId && <Check size={14} />}
              </button>
            ))}
          </div>
        </section>
      </div>
      <div className="hiveory-browser-agent-delivery-footer">
        <button type="button" className="is-secondary" onClick={onCancel}><ArrowLeft size={13} /> Cancel</button>
        <button type="button" className="is-primary" onClick={() => void deliver()} disabled={!selectedAgent || sending || !prompt}>
          {sending ? <Loader2 size={13} className="is-spinning" /> : <Send size={13} />}
          {sending ? 'Sending…' : 'Send feedback'}
        </button>
      </div>
    </div>
  )
}
