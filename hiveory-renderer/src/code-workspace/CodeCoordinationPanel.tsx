import React, { useCallback, useEffect, useState } from 'react'
import {
  Activity,
  AlertCircle,
  Ban,
  Bot,
  Check,
  CheckCheck,
  Clock3,
  CircleAlert,
  Inbox,
  MessageSquare,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Square,
  Workflow,
  X,
} from 'lucide-react'
import {
  hiveoryClient,
  type CodeAdapterSummary,
  type CodeDecisionGate,
  type CodeDispatch,
  type CodeGateState,
  type CodeMailboxDelivery,
  type CodeQuestion,
  type CodeRunDetail,
  type CodeRunSummary,
  type CodeTask,
  type CodeWorkspaceSummary,
} from '../api/hiveory-client'

interface CodeCoordinationPanelProps {
  workspace: CodeWorkspaceSummary
  onClose: () => void
}

function isActiveDispatch(state: CodeDispatch['state']): boolean {
  return ['preparing', 'running', 'awaiting_input', 'checkpointing'].includes(state)
}

function runStateLabel(state: CodeRunSummary['state']): string {
  return state.replaceAll('_', ' ')
}

function taskStateLabel(task: CodeTask): string {
  return task.state.replaceAll('_', ' ')
}

export const CodeCoordinationPanel: React.FC<CodeCoordinationPanelProps> = ({ workspace, onClose }) => {
  const [runs, setRuns] = useState<CodeRunSummary[]>([])
  const [adapters, setAdapters] = useState<CodeAdapterSummary[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CodeRunDetail | null>(null)
  const [mailbox, setMailbox] = useState<CodeMailboxDelivery[]>([])
  const [gates, setGates] = useState<CodeDecisionGate[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [title, setTitle] = useState('Workspace objective')
  const [objective, setObjective] = useState('Describe the bounded work for the coordinator and its workers.')
  const [selectedAdapterId, setSelectedAdapterId] = useState('codex-cli')
  const [questionAnswer, setQuestionAnswer] = useState('')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskSpecification, setTaskSpecification] = useState('')
  const [recipientAddress, setRecipientAddress] = useState('')
  const [messageKind, setMessageKind] = useState<'progress' | 'question' | 'escalation'>('progress')
  const [messagePayload, setMessagePayload] = useState('')
  const [gateTitle, setGateTitle] = useState('')
  const [gateReason, setGateReason] = useState('')

  const loadRuns = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [nextRuns, snapshot] = await Promise.all([
        hiveoryClient.codeRuns(workspace.id),
        hiveoryClient.codeSnapshot(),
      ])
      setRuns(nextRuns)
      setAdapters(snapshot.adapters)
      setSelectedAdapterId((current) => snapshot.adapters.some((adapter) => adapter.id === current) ? current : snapshot.adapters.find((adapter) => adapter.detected)?.id ?? snapshot.adapters[0]?.id ?? current)
      setSelectedRunId((current) => current && nextRuns.some((run) => run.id === current) ? current : nextRuns[0]?.id ?? null)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [workspace.id])

  const loadDetail = useCallback(async (runId: string) => {
    try {
      const nextDetail = await hiveoryClient.codeRun(runId)
      setDetail(nextDetail)
      const coordinatorAddress = `coordinator:${nextDetail.summary.coordinator_id}`
      const [nextMailbox, nextGates] = await Promise.all([
        hiveoryClient.codeMailbox({ run_id: runId, recipient_address: coordinatorAddress, include_acknowledged: true, limit: 80 }),
        hiveoryClient.codeGates({ run_id: runId, include_resolved: true }),
      ])
      setMailbox(nextMailbox)
      setGates(nextGates)
      setRecipientAddress((current) => current || (nextDetail.dispatches[0] ? `worker:${nextDetail.dispatches[0].id}` : coordinatorAddress))
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
      setDetail(null)
    }
  }, [])

  useEffect(() => {
    setMailbox([])
    setGates([])
    setRecipientAddress('')
    setMessagePayload('')
    setGateTitle('')
    setGateReason('')
  }, [selectedRunId])

  useEffect(() => {
    setSelectedRunId(null)
    setDetail(null)
    void loadRuns()
  }, [loadRuns])

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null)
      return undefined
    }
    void loadDetail(selectedRunId)
    return hiveoryClient.subscribeCodeOrchestration(selectedRunId, () => {
      void loadDetail(selectedRunId)
      void loadRuns()
    })
  }, [loadDetail, loadRuns, selectedRunId])

  const runAction = async (action: string, operation: () => Promise<CodeRunDetail>) => {
    setBusy(action)
    setError(null)
    try {
      const nextDetail = await operation()
      setDetail(nextDetail)
      setRuns((current) => current.map((run) => run.id === nextDetail.summary.id ? nextDetail.summary : run))
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  const createRun = async () => {
    if (!title.trim() || !objective.trim()) return
    setBusy('create')
    setError(null)
    try {
      const nextDetail = await hiveoryClient.createCodeRun({
        workspace_id: workspace.id,
        title: title.trim(),
        objective: objective.trim(),
        review_policy: 'manual',
        concurrency_limit: 2,
        model: null,
        adapter_id: selectedAdapterId || null,
        coordinator_id: null,
      })
      setDetail(nextDetail)
      setSelectedRunId(nextDetail.summary.id)
      setRuns((current) => [nextDetail.summary, ...current.filter((run) => run.id !== nextDetail.summary.id)])
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  const draftDag = async () => {
    if (!detail) return
    setBusy('proposal')
    setError(null)
    try {
      const proposal = await hiveoryClient.proposeCodeDag({ workspace_id: workspace.id, objective: detail.summary.objective, model: detail.summary.model })
      setDetail((current) => current ? { ...current, proposal } : current)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  const acceptDag = async () => {
    if (!detail?.proposal) return
    await runAction('accept-dag', () => hiveoryClient.acceptCodeDag({ run_id: detail.summary.id, proposal: detail.proposal! }))
  }

  const addTask = async () => {
    if (!detail || !taskTitle.trim() || !taskSpecification.trim()) return
    await runAction('add-task', () => hiveoryClient.createCodeTask({ run_id: detail.summary.id, client_id: null, title: taskTitle.trim(), specification: taskSpecification.trim(), depends_on: [] }))
    setTaskTitle('')
    setTaskSpecification('')
  }

  const answerQuestion = async (question: CodeQuestion) => {
    if (!detail || !questionAnswer.trim()) return
    const dispatch = detail.dispatches.find((candidate) => candidate.id === question.dispatch_id)
    if (!dispatch) return
    await runAction('answer', () => hiveoryClient.answerCodeQuestion({ run_id: detail.summary.id, task_id: question.task_id, dispatch_id: question.dispatch_id, lease_generation: dispatch.lease_generation, answer: questionAnswer.trim() }))
    setQuestionAnswer('')
  }

  const sendMailboxMessage = async () => {
    if (!detail || !messagePayload.trim() || !recipientAddress.trim()) return
    setBusy('message')
    setError(null)
    try {
      await hiveoryClient.sendCodeMailbox({
        run_id: detail.summary.id,
        sender_address: `coordinator:${detail.summary.coordinator_id}`,
        recipient_address: recipientAddress.trim(),
        kind: messageKind,
        payload: messagePayload.trim(),
        thread_id: null,
        client_request_id: null,
      })
      setMessagePayload('')
      setMailbox(await hiveoryClient.codeMailbox({ run_id: detail.summary.id, recipient_address: `coordinator:${detail.summary.coordinator_id}`, include_acknowledged: true, limit: 80 }))
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  const acknowledgeMailbox = async (delivery: CodeMailboxDelivery) => {
    if (!detail) return
    await runAction(`ack-${delivery.id}`, async () => {
      await hiveoryClient.acknowledgeCodeMailbox({ run_id: detail.summary.id, delivery_id: delivery.id, recipient_address: delivery.recipient_address })
      await loadDetail(detail.summary.id)
      return hiveoryClient.codeRun(detail.summary.id)
    })
  }

  const openGate = async () => {
    if (!detail || !gateTitle.trim() || !gateReason.trim()) return
    setBusy('gate')
    setError(null)
    try {
      await hiveoryClient.createCodeGate({ run_id: detail.summary.id, task_id: null, dispatch_id: null, title: gateTitle.trim(), reason: gateReason.trim(), allowed_actor: 'user', expires_at_unix_ms: null })
      setGateTitle('')
      setGateReason('')
      setGates(await hiveoryClient.codeGates({ run_id: detail.summary.id, include_resolved: true }))
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  const resolveGate = async (gate: CodeDecisionGate, state: Exclude<CodeGateState, 'open'>) => {
    if (!detail) return
    setBusy(`gate-${gate.id}`)
    setError(null)
    try {
      await hiveoryClient.resolveCodeGate({ run_id: detail.summary.id, gate_id: gate.id, actor: 'user', state, resolution: state === 'approved' ? 'Approved from the coordination surface.' : state === 'rejected' ? 'Rejected from the coordination surface.' : 'Timed out by the coordinator.' })
      setGates(await hiveoryClient.codeGates({ run_id: detail.summary.id, include_resolved: true }))
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  const activeQuestion = detail?.questions.find((question) => !question.answered) ?? null
  const activeDispatches = detail?.dispatches.filter((dispatch) => isActiveDispatch(dispatch.state)).length ?? 0
  const selectedAdapter = adapters.find((adapter) => adapter.id === selectedAdapterId)
  const coordinatorAddress = detail ? `coordinator:${detail.summary.coordinator_id}` : ''
  const workerRecipients = detail?.dispatches.map((dispatch) => `worker:${dispatch.id}`) ?? []
  const recipientOptions = [...new Set([coordinatorAddress, ...workerRecipients].filter(Boolean))]

  return (
    <aside className="code-coordination-panel" aria-label="Coordination">
      <header className="code-coordination-panel-header">
        <div className="code-coordination-panel-title">
          <span className="code-coordination-panel-icon"><Workflow size={16} aria-hidden="true" /></span>
          <div><strong>Coordination</strong><span>{workspace.display_name} · {hiveoryClient.isTauri ? 'local host' : 'browser preview'}</span></div>
        </div>
        <div className="code-source-panel-actions">
          <button type="button" className="code-source-icon-button" onClick={() => void loadRuns()} disabled={loading} aria-label="Refresh coordination" title="Refresh coordination"><RefreshCw size={14} className={loading ? 'is-spinning' : ''} aria-hidden="true" /></button>
          <button type="button" className="code-source-icon-button" onClick={onClose} aria-label="Close coordination" title="Close coordination"><X size={15} aria-hidden="true" /></button>
        </div>
      </header>

      {error && <div className="code-source-alert" role="alert"><AlertCircle size={14} aria-hidden="true" /><span>{error}</span></div>}

      <div className="code-coordination-summary">
        <span><strong>{runs.length}</strong> runs</span>
        <span><strong>{activeDispatches}</strong> active workers</span>
        <span><strong>{detail?.questions.filter((question) => !question.answered).length ?? 0}</strong> questions</span>
      </div>

      <div className="code-coordination-body">
        <section className="code-coordination-run-queue" aria-labelledby="code-coordination-run-queue-title">
          <div className="code-coordination-section-heading"><span id="code-coordination-run-queue-title">Run queue</span><span>{runs.length}</span></div>
          <div className="code-coordination-run-list">
            {runs.length === 0 ? <div className="code-coordination-empty"><Workflow size={17} aria-hidden="true" /><span>No runs yet. Create a bounded objective below.</span></div> : runs.map((run) => <button type="button" key={run.id} className={selectedRunId === run.id ? 'is-selected' : ''} onClick={() => setSelectedRunId(run.id)}><span className={`code-coordination-state-dot ${run.state}`} /><span><strong>{run.title}</strong><small>{run.completed_tasks}/{run.task_count} tasks · {runStateLabel(run.state)}</small></span></button>)}
          </div>
        </section>

        <section className="code-coordination-create" aria-labelledby="code-coordination-create-title">
          <div className="code-coordination-section-heading"><span id="code-coordination-create-title">New run</span><span>bounded</span></div>
          <label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Objective<textarea rows={3} value={objective} onChange={(event) => setObjective(event.target.value)} /></label>
          <label>Coordinator adapter<select value={selectedAdapterId} onChange={(event) => setSelectedAdapterId(event.target.value)}>{adapters.map((adapter) => <option key={adapter.id} value={adapter.id}>{adapter.display_name}{adapter.detected ? '' : ' · unavailable'}</option>)}</select></label>
          <button type="button" onClick={() => void createRun()} disabled={busy !== null || !title.trim() || !objective.trim() || !selectedAdapter}><Plus size={13} aria-hidden="true" />Create run</button>
        </section>

        {detail && <section className="code-coordination-detail" aria-labelledby="code-coordination-detail-title">
          <div className="code-coordination-detail-header"><div><span className="code-coordination-eyebrow">Selected run</span><h2 id="code-coordination-detail-title">{detail.summary.title}</h2><p>{detail.summary.objective}</p></div><span className={`code-coordination-run-badge ${detail.summary.state}`}>{runStateLabel(detail.summary.state)}</span></div>
          <div className="code-coordination-actions">
            {['draft', 'ready', 'paused', 'blocked'].includes(detail.summary.state) && <button type="button" onClick={() => void runAction('start', () => hiveoryClient.startCodeRun({ run_id: detail.summary.id }))} disabled={busy !== null}><Play size={12} aria-hidden="true" />Start</button>}
            {detail.summary.state === 'running' && <button type="button" className="is-secondary" onClick={() => void runAction('pause', () => hiveoryClient.pauseCodeRun({ run_id: detail.summary.id }))} disabled={busy !== null}><Pause size={12} aria-hidden="true" />Pause</button>}
            {!['completed', 'cancelled'].includes(detail.summary.state) && <button type="button" className="is-danger" onClick={() => void runAction('cancel', () => hiveoryClient.cancelCodeRun({ run_id: detail.summary.id }))} disabled={busy !== null}><Square size={11} aria-hidden="true" />Cancel</button>}
            <button type="button" className="is-secondary" onClick={() => void draftDag()} disabled={busy !== null}><Workflow size={12} aria-hidden="true" />Draft DAG</button>
          </div>

          {detail.proposal && <div className="code-coordination-proposal"><div><strong>Structured task proposal</strong><span>{detail.proposal.tasks.length} tasks · review before accepting</span></div><button type="button" onClick={() => void acceptDag()} disabled={busy !== null}><Check size={12} aria-hidden="true" />Accept</button></div>}

          <div className="code-coordination-block-heading"><Bot size={13} aria-hidden="true" /><span>Workers</span><small>{activeDispatches} active</small></div>
          <div className="code-coordination-worker-list">{detail.dispatches.length === 0 ? <p>No worker dispatches yet. Start the run after adding tasks.</p> : detail.dispatches.slice(0, 8).map((dispatch) => <WorkerRow key={dispatch.id} dispatch={dispatch} task={detail.tasks.find((task) => task.id === dispatch.task_id)} busy={busy !== null} onCancel={() => void runAction(`cancel-${dispatch.id}`, () => hiveoryClient.cancelCodeDispatch({ run_id: detail.summary.id, task_id: dispatch.task_id, dispatch_id: dispatch.id, lease_generation: dispatch.lease_generation }))} onResume={() => void runAction(`resume-${dispatch.id}`, () => hiveoryClient.resumeCodeDispatch({ run_id: detail.summary.id, task_id: dispatch.task_id, dispatch_id: dispatch.id, lease_generation: dispatch.lease_generation }))} />)}</div>

          <div className="code-coordination-block-heading"><Activity size={13} aria-hidden="true" /><span>Task readiness</span><small>{detail.tasks.length} tasks</small></div>
          <div className="code-coordination-task-list">{detail.tasks.length === 0 ? <p>Add a manual task or accept the proposed DAG.</p> : detail.tasks.map((task) => <div key={task.id}><span className={`code-coordination-task-dot ${task.state}`} /><div><strong>{task.title}</strong><small>{task.client_id} · {taskStateLabel(task)}</small></div><span>{task.attempt ? `attempt ${task.attempt}` : 'not started'}</span></div>)}</div>

          <div className="code-coordination-add-task"><div className="code-coordination-block-heading"><Plus size={13} aria-hidden="true" /><span>Add task</span></div><input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="Task title" /><textarea rows={2} value={taskSpecification} onChange={(event) => setTaskSpecification(event.target.value)} placeholder="Bounded worker specification" /><button type="button" onClick={() => void addTask()} disabled={busy !== null || !taskTitle.trim() || !taskSpecification.trim()}><Plus size={12} aria-hidden="true" />Add task</button></div>

          {activeQuestion && <QuestionCard question={activeQuestion} answer={questionAnswer} setAnswer={setQuestionAnswer} busy={busy !== null} onAnswer={() => void answerQuestion(activeQuestion)} />}

          <section className="code-coordination-mailbox" aria-labelledby="code-coordination-mailbox-title">
            <div className="code-coordination-block-heading"><Inbox size={13} aria-hidden="true" /><span id="code-coordination-mailbox-title">Durable inbox</span><small>{mailbox.filter((delivery) => !delivery.acknowledged).length} unread</small></div>
            <div className="code-coordination-message-list">
              {mailbox.length === 0 ? <p>No addressed messages yet. Worker progress and escalations appear here.</p> : mailbox.slice(-8).reverse().map((delivery) => <div key={delivery.id} className={delivery.acknowledged ? 'is-acknowledged' : ''}><div><strong>{delivery.kind}</strong><small>from {delivery.sender_address} · #{delivery.sequence}</small></div><p>{delivery.payload}</p>{!delivery.acknowledged && <button type="button" className="code-coordination-inline-button" onClick={() => void acknowledgeMailbox(delivery)} disabled={busy !== null} aria-label="Acknowledge message" title="Acknowledge message"><CheckCheck size={12} aria-hidden="true" /></button>}</div>)}
            </div>
            <div className="code-coordination-message-compose">
              <label>Recipient<input list="code-coordination-recipients" value={recipientAddress} onChange={(event) => setRecipientAddress(event.target.value)} placeholder="worker:dispatch-id" /><datalist id="code-coordination-recipients">{recipientOptions.map((recipient) => <option key={recipient} value={recipient} />)}</datalist></label>
              <label>Type<select value={messageKind} onChange={(event) => setMessageKind(event.target.value as typeof messageKind)}><option value="progress">Progress</option><option value="question">Question</option><option value="escalation">Escalation</option></select></label>
              <label className="code-coordination-message-field">Message<textarea rows={2} value={messagePayload} onChange={(event) => setMessagePayload(event.target.value)} placeholder="Send a bounded instruction or status request" /></label>
              <button type="button" onClick={() => void sendMailboxMessage()} disabled={busy !== null || !messagePayload.trim() || !recipientAddress.trim() || recipientAddress.trim() === coordinatorAddress}><Send size={12} aria-hidden="true" />Queue message</button>
            </div>
          </section>

          <section className="code-coordination-gates" aria-labelledby="code-coordination-gates-title">
            <div className="code-coordination-block-heading"><ShieldCheck size={13} aria-hidden="true" /><span id="code-coordination-gates-title">Decision gates</span><small>{gates.filter((gate) => gate.state === 'open').length} open</small></div>
            <div className="code-coordination-gate-list">
              {gates.length === 0 ? <p>No gates are blocking this run.</p> : gates.slice(0, 8).map((gate) => <div key={gate.id} className={`code-coordination-gate-row ${gate.state}`}><div><strong>{gate.title}</strong><p>{gate.reason}</p><small>{gate.state.replaceAll('_', ' ')} · actor {gate.allowed_actor}</small></div>{gate.state === 'open' && <div className="code-coordination-gate-actions"><button type="button" onClick={() => void resolveGate(gate, 'approved')} disabled={busy !== null}><Check size={11} aria-hidden="true" />Approve</button><button type="button" className="is-danger" onClick={() => void resolveGate(gate, 'rejected')} disabled={busy !== null}><Ban size={11} aria-hidden="true" />Reject</button></div>}</div>)}
            </div>
            <div className="code-coordination-gate-compose"><input value={gateTitle} onChange={(event) => setGateTitle(event.target.value)} placeholder="Gate title" /><input value={gateReason} onChange={(event) => setGateReason(event.target.value)} placeholder="What needs an explicit decision?" /><button type="button" onClick={() => void openGate()} disabled={busy !== null || !gateTitle.trim() || !gateReason.trim()}><Clock3 size={12} aria-hidden="true" />Open gate</button></div>
          </section>

          <div className="code-coordination-block-heading"><MessageSquare size={13} aria-hidden="true" /><span>Durable activity</span><small>{detail.events.length} retained events</small></div>
          <div className="code-coordination-event-list" aria-live="polite">{detail.events.slice(-8).reverse().map((event) => <div key={event.event_id}><span className={`code-coordination-event-origin ${event.origin}`}>{event.origin}</span><span>{event.payload}</span><small>#{event.sequence}</small></div>)}</div>
        </section>}
      </div>
    </aside>
  )
}

function WorkerRow({ dispatch, task, busy, onCancel, onResume }: { dispatch: CodeDispatch; task?: CodeTask; busy: boolean; onCancel: () => void; onResume: () => void }) {
  return <div className="code-coordination-worker-row"><span className={`code-coordination-task-dot ${dispatch.state}`} /><div><strong>{task?.title ?? 'Worker dispatch'}</strong><small>{dispatch.adapter_id} · {dispatch.session_id ? 'resumable session' : 'new session'} · lease {dispatch.lease_generation}</small></div><span className={`code-coordination-worker-state ${dispatch.state}`}>{dispatch.state.replaceAll('_', ' ')}</span>{isActiveDispatch(dispatch.state) && <button type="button" className="code-coordination-inline-button" onClick={onCancel} disabled={busy} aria-label="Cancel worker"><Square size={11} aria-hidden="true" /></button>}{dispatch.state === 'interrupted' && <button type="button" className="code-coordination-inline-button" onClick={onResume} disabled={busy} aria-label="Resume worker"><RotateCcw size={12} aria-hidden="true" /></button>}</div>
}

function QuestionCard({ question, answer, setAnswer, busy, onAnswer }: { question: CodeQuestion; answer: string; setAnswer: (value: string) => void; busy: boolean; onAnswer: () => void }) {
  return <div className="code-coordination-question"><div><CircleAlert size={14} aria-hidden="true" /><div><strong>Worker question</strong><span>{question.prompt}</span></div></div><div><input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Reply to the worker" /><button type="button" onClick={onAnswer} disabled={busy || !answer.trim()}><Send size={12} aria-hidden="true" />Reply</button></div></div>
}
