import { Activity, Bot, Check, CircleAlert, GitBranch, Pause, Play, Plus, RefreshCw, RotateCcw, Send, Sparkles, Square, Terminal, Workflow, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  hiveoryClient,
  type CodeDagProposal,
  type CodeDispatch,
  type CodeReviewDecision,
  type CodeRunDetail,
  type CodeRunSummary,
  type CodeTask,
  type CodeTerminalEvent,
  type CodeAdapterSummary,
  type CodeWorkspaceSummary,
} from '../../shared/api/hiveory-client'

export function HiveoryCodeRuns() {
  const [workspaces, setWorkspaces] = useState<CodeWorkspaceSummary[]>([])
  const [adapters, setAdapters] = useState<CodeAdapterSummary[]>([])
  const [selectedAdapterId, setSelectedAdapterId] = useState('codex-cli')
  const [runs, setRuns] = useState<CodeRunSummary[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [detail, setDetail] = useState<CodeRunDetail | null>(null)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [proposal, setProposal] = useState<CodeDagProposal | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [title, setTitle] = useState('New implementation run')
  const [objective, setObjective] = useState('Describe the coding objective for this run.')
  const [taskTitle, setTaskTitle] = useState('')
  const [taskSpecification, setTaskSpecification] = useState('')
  const [taskDependencies, setTaskDependencies] = useState<string[]>([])
  const [reviewFeedback, setReviewFeedback] = useState('')
  const [answer, setAnswer] = useState('')
  const [checkpointDiff, setCheckpointDiff] = useState<string | null>(null)
  const [terminalOutput, setTerminalOutput] = useState('')
  const [terminalId, setTerminalId] = useState<string | null>(null)
  const [liveAnnouncement, setLiveAnnouncement] = useState('')
  const eventCursorRef = useRef(0)
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === detail?.summary.workspace_id) ?? workspaces[0]
  const selectedTask = detail?.tasks.find((task) => task.id === selectedTaskId) ?? detail?.tasks[0] ?? null

  const loadRuns = useCallback(async (workspaceId?: string) => {
    const nextRuns = await hiveoryClient.codeRuns(workspaceId)
    setRuns(nextRuns)
    setSelectedRunId((current) => current && nextRuns.some((run) => run.id === current) ? current : nextRuns[0]?.id ?? null)
  }, [])

  const loadRun = useCallback(async (runId: string) => {
    const nextDetail = await hiveoryClient.codeRun(runId)
    setDetail(nextDetail)
    eventCursorRef.current = nextDetail.event_cursor
    setSelectedTaskId((current) => current && nextDetail.tasks.some((task) => task.id === current) ? current : nextDetail.tasks[0]?.id ?? null)
  }, [])

  useEffect(() => {
    void hiveoryClient.codeSnapshot().then((snapshot) => { setWorkspaces(snapshot.workspaces); setAdapters(snapshot.adapters); setSelectedAdapterId((current) => snapshot.adapters.find((item) => item.id === current && item.detected)?.id ?? snapshot.adapters.find((item) => item.detected)?.id ?? current); return loadRuns() }).catch((error) => setFeedback(error instanceof Error ? error.message : 'Runs could not be loaded.'))
  }, [loadRuns])

  useEffect(() => {
    if (!selectedRunId) { setDetail(null); return }
    let disposed = false
    void loadRun(selectedRunId).catch((error) => { if (!disposed) setFeedback(error instanceof Error ? error.message : 'The run could not be loaded.') })
    const unsubscribe = hiveoryClient.subscribeCodeOrchestration(selectedRunId, (event) => {
      eventCursorRef.current = Math.max(eventCursorRef.current, event.sequence)
      setLiveAnnouncement(`${event.kind.replaceAll('_', ' ')}: ${event.payload}`)
      setFeedback(event.payload)
      void loadRun(selectedRunId)
      void loadRuns()
    }, eventCursorRef.current)
    return () => { disposed = true; unsubscribe() }
  }, [loadRun, loadRuns, selectedRunId])

  const runAction = async (name: string, action: () => Promise<CodeRunDetail>) => {
    setBusy(name); setFeedback(null)
    try { const nextDetail = await action(); setDetail(nextDetail); setRuns((items) => items.map((run) => run.id === nextDetail.summary.id ? nextDetail.summary : run)); setSelectedTaskId((current) => current ?? nextDetail.tasks[0]?.id ?? null) }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'The run action could not be completed.') }
    finally { setBusy(null) }
  }

  const createRun = async () => {
    if (!selectedWorkspace) { setFeedback('Open a workspace from Workbench before creating a run.'); return }
    setBusy('create-run'); setFeedback(null)
    try {
      const nextDetail = await hiveoryClient.createCodeRun({ workspace_id: selectedWorkspace.id, title, objective, review_policy: 'manual', concurrency_limit: 2, model: null, adapter_id: selectedAdapterId })
      setDetail(nextDetail); setSelectedRunId(nextDetail.summary.id); setRuns((items) => [nextDetail.summary, ...items]); setTitle('New implementation run'); setObjective('Describe the coding objective for this run.')
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'The run could not be created.') }
    finally { setBusy(null) }
  }

  const addTask = async () => {
    if (!detail || !taskTitle.trim() || !taskSpecification.trim()) { setFeedback('Add a task title and bounded specification.'); return }
    await runAction('add-task', () => hiveoryClient.createCodeTask({ run_id: detail.summary.id, client_id: null, title: taskTitle, specification: taskSpecification, depends_on: taskDependencies }))
    setTaskTitle(''); setTaskSpecification(''); setTaskDependencies([])
  }

  const propose = async () => {
    if (!selectedWorkspace) { setFeedback('Open a workspace from Workbench before asking for a proposal.'); return }
    setBusy('proposal'); setFeedback(null)
    try { setProposal(await hiveoryClient.proposeCodeDag({ workspace_id: selectedWorkspace.id, objective: detail?.summary.objective ?? objective, model: detail?.summary.model ?? null })); setFeedback('Proposal ready. Review it before accepting.') }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'The DAG proposal could not be generated.') }
    finally { setBusy(null) }
  }

  const acceptProposal = async () => {
    if (!detail || !proposal) return
    await runAction('accept-proposal', () => hiveoryClient.acceptCodeDag({ run_id: detail.summary.id, proposal }))
    setProposal(null)
  }

  const review = async (decision: CodeReviewDecision) => {
    if (!detail || !selectedTask?.latest_checkpoint_id) return
    await runAction(`review-${decision}`, () => hiveoryClient.reviewCodeCheckpoint({ run_id: detail.summary.id, task_id: selectedTask.id, checkpoint_id: selectedTask.latest_checkpoint_id!, decision, feedback: reviewFeedback.trim() || null }))
    setReviewFeedback('')
  }

  const showDiff = async () => {
    if (!detail || !selectedTask?.latest_checkpoint_id) return
    setBusy('diff')
    try {
      const diff = await hiveoryClient.codeCheckpointDiff({ run_id: detail.summary.id, checkpoint_id: selectedTask.latest_checkpoint_id, compare_to_checkpoint_id: null })
      setCheckpointDiff(diff.content || 'No textual changes were reported for this checkpoint.')
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'The checkpoint diff could not be loaded.') }
    finally { setBusy(null) }
  }

  const openTerminal = async (dispatch: CodeDispatch) => {
    if (!detail) return
    setBusy(`terminal-${dispatch.id}`); setTerminalOutput('')
    try {
      const summary = await hiveoryClient.openCodeDispatchTerminal({ run_id: detail.summary.id, dispatch_id: dispatch.id, cols: 100, rows: 28 }, (event) => handleTerminalEvent(event))
      setTerminalId(summary.id); setFeedback(`Terminal attached to attempt ${dispatch.attempt}.`)
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'The dispatch terminal could not be opened.') }
    finally { setBusy(null) }
  }

  const handleTerminalEvent = (event: CodeTerminalEvent) => {
    if (event.kind === 'output' && event.data_base64) {
      const bytes = Uint8Array.from(atob(event.data_base64), (character) => character.charCodeAt(0))
      setTerminalOutput((current) => `${current}${new TextDecoder().decode(bytes)}`.slice(-16000))
    }
    if (event.kind === 'error' || event.kind === 'exited') setFeedback(event.message ?? `Terminal ${event.kind}.`)
  }

  useEffect(() => { setCheckpointDiff(null) }, [selectedRunId, selectedTaskId])

  const cancelDispatch = async (dispatch: CodeDispatch) => {
    if (!detail) return
    await runAction(`cancel-dispatch-${dispatch.id}`, () => hiveoryClient.cancelCodeDispatch({ run_id: detail.summary.id, task_id: dispatch.task_id, dispatch_id: dispatch.id, lease_generation: dispatch.lease_generation }))
  }

  const resumeDispatch = async (dispatch: CodeDispatch) => {
    if (!detail) return
    await runAction(`resume-dispatch-${dispatch.id}`, () => hiveoryClient.resumeCodeDispatch({ run_id: detail.summary.id, task_id: dispatch.task_id, dispatch_id: dispatch.id, lease_generation: dispatch.lease_generation }))
  }

  const pendingQuestion = detail?.questions.find((question) => !question.answered) ?? null
  const runningDispatches = detail?.dispatches.filter((dispatch) => ['preparing', 'running', 'awaiting_input', 'checkpointing'].includes(dispatch.state)) ?? []

  return <section className="hiveory-runs" aria-labelledby="hiveory-runs-title">
    <header className="hiveory-runs-header">
      <div className="hiveory-content-header"><Workflow size={22} aria-hidden="true" /><div><p className="hiveory-eyebrow">Code orchestration</p><h1 id="hiveory-runs-title">Runs</h1></div></div>
      <div className="hiveory-runs-header-actions"><span className="hiveory-runs-host-status"><Activity size={14} />{hiveoryClient.isTauri ? 'Durable local host' : 'Browser preview'}</span><button className="is-secondary" onClick={() => void loadRuns()} disabled={busy !== null}><RefreshCw size={14} />Refresh</button></div>
    </header>
    <div className="hiveory-runs-layout">
      <aside className="hiveory-runs-sidebar" aria-label="Code runs">
        <div className="hiveory-runs-sidebar-heading"><span>Run queue</span><span className="hiveory-code-count">{runs.length}</span></div>
        <div className="hiveory-run-create"><label htmlFor="hiveory-run-title">Run title</label><input id="hiveory-run-title" value={title} onChange={(event) => setTitle(event.target.value)} /><label htmlFor="hiveory-run-objective">Objective</label><textarea id="hiveory-run-objective" rows={4} value={objective} onChange={(event) => setObjective(event.target.value)} /><label htmlFor="hiveory-run-engine">Worker engine</label><select id="hiveory-run-engine" value={selectedAdapterId} onChange={(event) => setSelectedAdapterId(event.target.value)}>{adapters.map((item) => <option key={item.id} value={item.id}>{item.display_name}{item.detected ? ' · ready' : ' · not detected'}</option>)}</select><button onClick={() => void createRun()} disabled={busy !== null || !selectedWorkspace || !adapters.some((item) => item.id === selectedAdapterId && item.detected)}><Plus size={14} />Create run</button>{!selectedWorkspace && <p>Open a workspace from Workbench first.</p>}{selectedWorkspace && !adapters.some((item) => item.id === selectedAdapterId && item.detected) && <p>Install the selected engine before creating a worker run.</p>}</div>
        <div className="hiveory-run-list">{runs.length ? runs.map((run) => <button key={run.id} className={run.id === selectedRunId ? 'is-active' : ''} onClick={() => setSelectedRunId(run.id)}><span className={`hiveory-run-state ${run.state}`} aria-hidden="true" /><span><strong>{run.title}</strong><small>{run.completed_tasks}/{run.task_count} tasks · {run.state.replaceAll('_', ' ')}</small></span></button>) : <div className="hiveory-run-list-empty"><Workflow size={20} /><p>No runs yet. Create one after opening a workspace.</p></div>}</div>
      </aside>
      <main className="hiveory-runs-main">
        {!detail ? <div className="hiveory-runs-empty"><div className="hiveory-empty-mark"><Workflow size={28} /></div><h2>Coordinate work in reviewable lanes</h2><p>Each run owns a durable DAG, isolated worker worktrees, checkpoints, and explicit review decisions.</p></div> : <>
          <div className="hiveory-runs-toolbar"><div><p className="hiveory-eyebrow">{selectedWorkspace?.display_name ?? 'Workspace'} · {detail.summary.review_policy} review</p><h2>{detail.summary.title}</h2><p>{detail.summary.objective}</p><div className="hiveory-run-meta" aria-label="Run execution metadata"><span>Coordinator <code>{detail.summary.coordinator_id}</code></span><span>Adapter <code>{detail.summary.adapter_id}</code></span><span>Concurrency <code>{detail.summary.active_dispatches}/{Math.min(detail.summary.concurrency_limit, detail.summary.host_concurrency_cap)}</code></span><span>Trust <code>{selectedWorkspace?.trust ?? 'unknown'}</code></span></div></div><div className="hiveory-runs-toolbar-actions"><span className={`hiveory-run-badge ${detail.summary.state}`}>{detail.summary.state.replaceAll('_', ' ')}</span>{['draft', 'ready', 'paused', 'blocked'].includes(detail.summary.state) && <button onClick={() => void runAction('start', () => hiveoryClient.startCodeRun({ run_id: detail.summary.id }))} disabled={busy !== null}><Play size={14} />Start</button>}{detail.summary.state === 'interrupted' && <span className="hiveory-code-muted">Resume each interrupted lane below</span>}{detail.summary.state === 'running' && <button className="is-secondary" onClick={() => void runAction('pause', () => hiveoryClient.pauseCodeRun({ run_id: detail.summary.id }))} disabled={busy !== null}><Pause size={14} />Pause</button>}{!['completed', 'cancelled'].includes(detail.summary.state) && <button className="is-danger" onClick={() => void runAction('cancel', () => hiveoryClient.cancelCodeRun({ run_id: detail.summary.id }))} disabled={busy !== null}><Square size={13} />Cancel</button>}</div></div>
          {feedback && <div className="hiveory-feedback hiveory-runs-feedback" role="status">{feedback}</div>}
          <div className="hiveory-runs-content-grid">
            <section className="hiveory-run-board" aria-labelledby="hiveory-dag-title"><div className="hiveory-run-section-heading"><div><Workflow size={15} /><h3 id="hiveory-dag-title">Task DAG</h3><span>{detail.tasks.length} tasks</span></div><button className="is-secondary" onClick={() => void propose()} disabled={busy !== null || !selectedWorkspace}><Sparkles size={14} />Draft task DAG</button></div>
              {proposal && <div className="hiveory-proposal-card"><div className="hiveory-proposal-heading"><div><Sparkles size={15} /><strong>Structured proposal</strong></div><button className="hiveory-mini-button" onClick={() => setProposal(null)} aria-label="Dismiss proposal"><X size={13} /></button></div><p>Review {proposal.tasks.length} proposed tasks before they become runnable.</p><div className="hiveory-proposal-list">{proposal.tasks.map((task) => <div key={task.client_id}><span className="hiveory-proposal-index">{task.client_id}</span><span><strong>{task.title}</strong><small>{task.depends_on.length ? `Depends on ${task.depends_on.join(', ')}` : 'No dependencies'}</small></span></div>)}</div>{proposal.warnings.map((warning) => <p key={warning} className="hiveory-proposal-warning"><CircleAlert size={13} />{warning}</p>)}<button onClick={() => void acceptProposal()} disabled={busy !== null}><Check size={14} />Accept proposal into run</button></div>}
              <div className="hiveory-dag-list">{detail.tasks.length ? detail.tasks.map((task, index) => <TaskNode key={task.id} task={task} index={index} selected={task.id === selectedTask?.id} dependencies={detail.dependencies.filter((dependency) => dependency.task_id === task.id).map((dependency) => detail.tasks.find((candidate) => candidate.id === dependency.depends_on_task_id)?.client_id ?? dependency.depends_on_task_id)} onSelect={() => setSelectedTaskId(task.id)} />) : <div className="hiveory-run-board-empty"><Bot size={22} /><p>Add a task manually or draft a structured DAG.</p></div>}</div>
            </section>
            <aside className="hiveory-run-inspector" aria-label="Selected task inspector"><div className="hiveory-run-section-heading"><div><GitBranch size={15} /><h3>Inspector</h3></div></div>{selectedTask ? <TaskInspector task={selectedTask} detail={detail} onReview={review} reviewFeedback={reviewFeedback} setReviewFeedback={setReviewFeedback} onDiff={() => void showDiff()} diff={checkpointDiff} diffBusy={busy === 'diff'} /> : <p className="hiveory-code-muted">Select a task to inspect its specification, worker lease, checkpoint, or review.</p>}</aside>
          </div>
          <section className="hiveory-worker-lanes" aria-labelledby="hiveory-worker-lanes-title"><div className="hiveory-run-section-heading"><div><Bot size={15} /><h3 id="hiveory-worker-lanes-title">Worker lanes</h3><span>{runningDispatches.length} active</span></div><span className="hiveory-code-muted">Concurrency {detail.summary.active_dispatches}/{Math.min(detail.summary.concurrency_limit, detail.summary.host_concurrency_cap)}</span></div>{detail.dispatches.length ? <div className="hiveory-worker-lane-grid">{detail.dispatches.slice(0, 8).map((dispatch) => <WorkerLane key={dispatch.id} dispatch={dispatch} task={detail.tasks.find((task) => task.id === dispatch.task_id)} busy={busy !== null} onCancel={() => void cancelDispatch(dispatch)} onResume={() => void resumeDispatch(dispatch)} onOpenTerminal={() => void openTerminal(dispatch)} />)}</div> : <p className="hiveory-code-muted">Workers appear here after the run starts. Every worker receives an isolated managed worktree.</p>}</section>
          {terminalId && <section className="hiveory-run-terminal" aria-labelledby="hiveory-run-terminal-title"><div className="hiveory-run-section-heading"><div><Terminal size={15} /><h3 id="hiveory-run-terminal-title">Attached dispatch terminal</h3></div><span className="hiveory-code-muted"><code>{terminalId}</code></span></div><pre aria-live="polite">{terminalOutput || 'Terminal connected. Worker output will appear here.'}</pre></section>}
          <section className="hiveory-run-events" aria-labelledby="hiveory-run-events-title"><div className="hiveory-run-section-heading"><div><Activity size={15} /><h3 id="hiveory-run-events-title">Event timeline</h3><span>{detail.events.length} retained</span></div><span className="hiveory-code-muted">Cursor {detail.event_cursor}</span></div><div className="hiveory-run-event-list" aria-live="polite">{detail.events.slice(-12).reverse().map((event) => <div key={event.event_id}><span className={`hiveory-event-origin ${event.origin}`}>{event.origin}</span><code>#{event.sequence}</code><span>{event.payload}</span><small>{event.kind.replaceAll('_', ' ')}</small></div>)}</div></section>
          <div className="hiveory-sr-only" aria-live="polite">{liveAnnouncement}</div>
          {pendingQuestion && <section className="hiveory-run-question" aria-labelledby="hiveory-question-title"><div><CircleAlert size={17} /><div><h3 id="hiveory-question-title">Worker needs your input</h3><p>{pendingQuestion.prompt}</p></div></div><div className="hiveory-run-question-form"><input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Answer the worker" aria-label="Worker answer" /><button onClick={() => { if (!detail) return; void runAction('answer', () => hiveoryClient.answerCodeQuestion({ run_id: detail.summary.id, task_id: pendingQuestion.task_id, dispatch_id: pendingQuestion.dispatch_id, lease_generation: detail.dispatches.find((dispatch) => dispatch.id === pendingQuestion.dispatch_id)?.lease_generation ?? 0, answer })) }} disabled={busy !== null || !answer.trim()}><Send size={14} />Answer</button></div></section>}
          {detail.summary.state === 'draft' || detail.summary.state === 'ready' || detail.summary.state === 'blocked' ? <section className="hiveory-add-task" aria-labelledby="hiveory-add-task-title"><div className="hiveory-run-section-heading"><div><Plus size={15} /><h3 id="hiveory-add-task-title">Add manual task</h3></div><span className="hiveory-code-muted">Use client IDs in dependencies</span></div><div className="hiveory-add-task-grid"><label>Title<input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="e.g. Add persistence tests" /></label><label>Specification<textarea rows={2} value={taskSpecification} onChange={(event) => setTaskSpecification(event.target.value)} placeholder="Bounded implementation and validation instructions" /></label><label>Dependencies<select multiple value={taskDependencies} onChange={(event) => setTaskDependencies([...event.target.selectedOptions].map((option) => option.value))}>{detail.tasks.map((task) => <option key={task.id} value={task.id}>{task.client_id}</option>)}</select></label><button onClick={() => void addTask()} disabled={busy !== null || !taskTitle.trim() || !taskSpecification.trim()}><Plus size={14} />Add task</button></div></section> : null}
        </>}
      </main>
    </div>
  </section>
}

function TaskNode({ task, index, selected, dependencies, onSelect }: { task: CodeTask; index: number; selected: boolean; dependencies: string[]; onSelect: () => void }) {
  return <button className={`hiveory-dag-node ${selected ? 'is-selected' : ''}`} onClick={onSelect} aria-pressed={selected}><span className="hiveory-dag-index">{String(index + 1).padStart(2, '0')}</span><span className="hiveory-dag-copy"><strong>{task.title}</strong><small>{task.client_id} · {task.state.replaceAll('_', ' ')}</small>{dependencies.length > 0 && <span className="hiveory-dag-dependencies">{dependencies.map((dependency) => <span key={dependency}>← {dependency}</span>)}</span>}</span><span className={`hiveory-task-status ${task.state}`} aria-label={`Task ${task.state}`} /></button>
}

function WorkerLane({ dispatch, task, busy, onCancel, onResume, onOpenTerminal }: { dispatch: CodeDispatch; task?: CodeTask; busy: boolean; onCancel: () => void; onResume: () => void; onOpenTerminal: () => void }) {
  const active = ['preparing', 'running', 'awaiting_input', 'checkpointing'].includes(dispatch.state)
  return <article className="hiveory-worker-lane"><div className="hiveory-worker-lane-top"><span className="hiveory-worker-pulse" aria-hidden="true" /><strong>{task?.title ?? 'Unknown task'}</strong><span className={`hiveory-run-badge ${dispatch.state}`}>{dispatch.state.replaceAll('_', ' ')}</span></div><div className="hiveory-worker-lane-meta"><span>Attempt {dispatch.attempt}</span><span>{dispatch.session_id ? 'resumable session' : 'new session'}</span><span>{dispatch.pid ? `PID ${dispatch.pid}` : 'awaiting process'}</span><span>Lease {dispatch.lease_generation}</span>{dispatch.last_heartbeat_at_unix_ms && <span>Heartbeat {new Date(dispatch.last_heartbeat_at_unix_ms).toLocaleTimeString()}</span>}</div>{dispatch.result_summary && <p>{dispatch.result_summary}</p>}{dispatch.error && <p className="hiveory-worker-error">{dispatch.error}</p>}<div className="hiveory-worker-lane-actions">{active && <button className="is-secondary" onClick={onCancel} disabled={busy}><Square size={12} />Cancel dispatch</button>}{dispatch.state === 'interrupted' && <button onClick={onResume} disabled={busy}><RotateCcw size={12} />Resume</button>}{dispatch.worktree_id && ['preparing', 'running', 'awaiting_input', 'checkpointing', 'interrupted'].includes(dispatch.state) && <button className="is-secondary" onClick={onOpenTerminal} disabled={busy}><Terminal size={12} />Open terminal</button>}</div></article>
}

function TaskInspector({ task, detail, onReview, reviewFeedback, setReviewFeedback, onDiff, diff, diffBusy }: { task: CodeTask; detail: CodeRunDetail; onReview: (decision: CodeReviewDecision) => Promise<void>; reviewFeedback: string; setReviewFeedback: (value: string) => void; onDiff: () => void; diff: string | null; diffBusy: boolean }) {
  const dispatch = detail.dispatches.find((candidate) => candidate.id === task.active_dispatch_id) ?? detail.dispatches.find((candidate) => candidate.task_id === task.id)
  const checkpoint = detail.checkpoints.find((candidate) => candidate.id === task.latest_checkpoint_id)
  const canReview = task.state === 'awaiting_review' && Boolean(task.latest_checkpoint_id)
  return <div className="hiveory-task-inspector"><div className="hiveory-task-inspector-title"><span className={`hiveory-task-status ${task.state}`} /><div><h4>{task.title}</h4><p>{task.client_id} · attempt {task.attempt}</p></div></div><dl><div><dt>State</dt><dd>{task.state.replaceAll('_', ' ')}</dd></div><div><dt>Worker</dt><dd>{dispatch?.state.replaceAll('_', ' ') ?? 'not dispatched'}</dd></div><div><dt>Checkpoint</dt><dd>{checkpoint ? checkpoint.kind : 'none'}</dd></div><div><dt>Lease</dt><dd>{dispatch ? `generation ${dispatch.lease_generation}` : 'none'}</dd></div><div><dt>Terminal</dt><dd>{dispatch?.terminal_id ? 'attached' : 'none'}</dd></div></dl><div className="hiveory-task-spec"><span>Specification</span><p>{task.specification}</p></div>{task.error && <div className="hiveory-task-error"><CircleAlert size={14} />{task.error}</div>}{checkpoint && <div className="hiveory-checkpoint"><div><span>Checkpoint {checkpoint.kind}</span><code>{checkpoint.commit_oid?.slice(0, 10) ?? 'pending'}</code></div><button className="is-secondary" onClick={onDiff} disabled={diffBusy}>{diffBusy ? 'Loading diff…' : 'View checkpoint diff'}</button>{diff && <pre>{diff}</pre>}</div>}{canReview && <div className="hiveory-review-form"><label htmlFor="hiveory-review-feedback">Review feedback</label><textarea id="hiveory-review-feedback" rows={3} value={reviewFeedback} onChange={(event) => setReviewFeedback(event.target.value)} placeholder="Optional acceptance notes or requested changes" /><div><button onClick={() => void onReview('accept')}><Check size={14} />Accept</button><button className="is-secondary" onClick={() => void onReview('request_changes')}><RotateCcw size={14} />Request changes</button><button className="is-danger" onClick={() => void onReview('reject')}><X size={14} />Reject</button></div></div>}</div>
}
