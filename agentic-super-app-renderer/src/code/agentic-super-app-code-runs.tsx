import { Activity, Bot, Check, CircleAlert, GitBranch, Pause, Play, Plus, RefreshCw, RotateCcw, Send, Sparkles, Square, Workflow, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  agenticSuperAppClient,
  type CodeDagProposal,
  type CodeDispatch,
  type CodeReviewDecision,
  type CodeRunDetail,
  type CodeRunSummary,
  type CodeTask,
  type CodeWorkspaceSummary,
} from '../api/agentic-super-app-client'

export function AgenticSuperAppCodeRuns() {
  const [workspaces, setWorkspaces] = useState<CodeWorkspaceSummary[]>([])
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
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === detail?.summary.workspace_id) ?? workspaces[0]
  const selectedTask = detail?.tasks.find((task) => task.id === selectedTaskId) ?? detail?.tasks[0] ?? null

  const loadRuns = useCallback(async (workspaceId?: string) => {
    const nextRuns = await agenticSuperAppClient.codeRuns(workspaceId)
    setRuns(nextRuns)
    setSelectedRunId((current) => current && nextRuns.some((run) => run.id === current) ? current : nextRuns[0]?.id ?? null)
  }, [])

  const loadRun = useCallback(async (runId: string) => {
    const nextDetail = await agenticSuperAppClient.codeRun(runId)
    setDetail(nextDetail)
    setSelectedTaskId((current) => current && nextDetail.tasks.some((task) => task.id === current) ? current : nextDetail.tasks[0]?.id ?? null)
  }, [])

  useEffect(() => {
    void agenticSuperAppClient.codeSnapshot().then((snapshot) => { setWorkspaces(snapshot.workspaces); return loadRuns() }).catch((error) => setFeedback(error instanceof Error ? error.message : 'Runs could not be loaded.'))
  }, [loadRuns])

  useEffect(() => {
    if (!selectedRunId) { setDetail(null); return }
    void loadRun(selectedRunId).catch((error) => setFeedback(error instanceof Error ? error.message : 'The run could not be loaded.'))
    return agenticSuperAppClient.subscribeCodeOrchestration(selectedRunId, (event) => {
      setFeedback(event.payload)
      void loadRun(selectedRunId)
      void loadRuns()
    }, detail?.event_cursor ?? 0)
  }, [detail?.event_cursor, loadRun, loadRuns, selectedRunId])

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
      const nextDetail = await agenticSuperAppClient.createCodeRun({ workspace_id: selectedWorkspace.id, title, objective, review_policy: 'manual', concurrency_limit: 2, model: null })
      setDetail(nextDetail); setSelectedRunId(nextDetail.summary.id); setRuns((items) => [nextDetail.summary, ...items]); setTitle('New implementation run'); setObjective('Describe the coding objective for this run.')
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'The run could not be created.') }
    finally { setBusy(null) }
  }

  const addTask = async () => {
    if (!detail || !taskTitle.trim() || !taskSpecification.trim()) { setFeedback('Add a task title and bounded specification.'); return }
    await runAction('add-task', () => agenticSuperAppClient.createCodeTask({ run_id: detail.summary.id, client_id: null, title: taskTitle, specification: taskSpecification, depends_on: taskDependencies }))
    setTaskTitle(''); setTaskSpecification(''); setTaskDependencies([])
  }

  const propose = async () => {
    if (!selectedWorkspace) { setFeedback('Open a workspace from Workbench before asking for a proposal.'); return }
    setBusy('proposal'); setFeedback(null)
    try { setProposal(await agenticSuperAppClient.proposeCodeDag({ workspace_id: selectedWorkspace.id, objective: detail?.summary.objective ?? objective, model: detail?.summary.model ?? null })); setFeedback('Proposal ready. Review it before accepting.') }
    catch (error) { setFeedback(error instanceof Error ? error.message : 'The DAG proposal could not be generated.') }
    finally { setBusy(null) }
  }

  const acceptProposal = async () => {
    if (!detail || !proposal) return
    await runAction('accept-proposal', () => agenticSuperAppClient.acceptCodeDag({ run_id: detail.summary.id, proposal }))
    setProposal(null)
  }

  const review = async (decision: CodeReviewDecision) => {
    if (!detail || !selectedTask?.latest_checkpoint_id) return
    await runAction(`review-${decision}`, () => agenticSuperAppClient.reviewCodeCheckpoint({ run_id: detail.summary.id, task_id: selectedTask.id, checkpoint_id: selectedTask.latest_checkpoint_id!, decision, feedback: reviewFeedback.trim() || null }))
    setReviewFeedback('')
  }

  const pendingQuestion = detail?.questions.find((question) => !question.answered) ?? null
  const runningDispatches = detail?.dispatches.filter((dispatch) => ['preparing', 'running', 'awaiting_input', 'checkpointing'].includes(dispatch.state)) ?? []

  return <section className="agentic-super-app-runs" aria-labelledby="agentic-super-app-runs-title">
    <header className="agentic-super-app-runs-header">
      <div className="agentic-super-app-content-header"><Workflow size={22} aria-hidden="true" /><div><p className="agentic-super-app-eyebrow">Code orchestration</p><h1 id="agentic-super-app-runs-title">Runs</h1></div></div>
      <div className="agentic-super-app-runs-header-actions"><span className="agentic-super-app-runs-host-status"><Activity size={14} />{agenticSuperAppClient.isTauri ? 'Durable local host' : 'Browser preview'}</span><button className="is-secondary" onClick={() => void loadRuns()} disabled={busy !== null}><RefreshCw size={14} />Refresh</button></div>
    </header>
    <div className="agentic-super-app-runs-layout">
      <aside className="agentic-super-app-runs-sidebar" aria-label="Code runs">
        <div className="agentic-super-app-runs-sidebar-heading"><span>Run queue</span><span className="agentic-super-app-code-count">{runs.length}</span></div>
        <div className="agentic-super-app-run-create"><label htmlFor="agentic-super-app-run-title">Run title</label><input id="agentic-super-app-run-title" value={title} onChange={(event) => setTitle(event.target.value)} /><label htmlFor="agentic-super-app-run-objective">Objective</label><textarea id="agentic-super-app-run-objective" rows={4} value={objective} onChange={(event) => setObjective(event.target.value)} /><button onClick={() => void createRun()} disabled={busy !== null || !selectedWorkspace}><Plus size={14} />Create run</button>{!selectedWorkspace && <p>Open a workspace from Workbench first.</p>}</div>
        <div className="agentic-super-app-run-list">{runs.length ? runs.map((run) => <button key={run.id} className={run.id === selectedRunId ? 'is-active' : ''} onClick={() => setSelectedRunId(run.id)}><span className={`agentic-super-app-run-state ${run.state}`} aria-hidden="true" /><span><strong>{run.title}</strong><small>{run.completed_tasks}/{run.task_count} tasks · {run.state.replaceAll('_', ' ')}</small></span></button>) : <div className="agentic-super-app-run-list-empty"><Workflow size={20} /><p>No runs yet. Create one after opening a workspace.</p></div>}</div>
      </aside>
      <main className="agentic-super-app-runs-main">
        {!detail ? <div className="agentic-super-app-runs-empty"><div className="agentic-super-app-empty-mark"><Workflow size={28} /></div><h2>Coordinate work in reviewable lanes</h2><p>Each run owns a durable DAG, isolated worker worktrees, checkpoints, and explicit review decisions.</p></div> : <>
          <div className="agentic-super-app-runs-toolbar"><div><p className="agentic-super-app-eyebrow">{selectedWorkspace?.display_name ?? 'Workspace'} · {detail.summary.review_policy} review</p><h2>{detail.summary.title}</h2><p>{detail.summary.objective}</p></div><div className="agentic-super-app-runs-toolbar-actions"><span className={`agentic-super-app-run-badge ${detail.summary.state}`}>{detail.summary.state.replaceAll('_', ' ')}</span>{['draft', 'ready', 'paused', 'blocked', 'interrupted'].includes(detail.summary.state) && <button onClick={() => void runAction('start', () => agenticSuperAppClient.startCodeRun({ run_id: detail.summary.id }))} disabled={busy !== null}><Play size={14} />Start</button>}{detail.summary.state === 'running' && <button className="is-secondary" onClick={() => void runAction('pause', () => agenticSuperAppClient.pauseCodeRun({ run_id: detail.summary.id }))} disabled={busy !== null}><Pause size={14} />Pause</button>}{!['completed', 'cancelled'].includes(detail.summary.state) && <button className="is-danger" onClick={() => void runAction('cancel', () => agenticSuperAppClient.cancelCodeRun({ run_id: detail.summary.id }))} disabled={busy !== null}><Square size={13} />Cancel</button>}</div></div>
          {feedback && <div className="agentic-super-app-feedback agentic-super-app-runs-feedback" role="status">{feedback}</div>}
          <div className="agentic-super-app-runs-content-grid">
            <section className="agentic-super-app-run-board" aria-labelledby="agentic-super-app-dag-title"><div className="agentic-super-app-run-section-heading"><div><Workflow size={15} /><h3 id="agentic-super-app-dag-title">Task DAG</h3><span>{detail.tasks.length} tasks</span></div><button className="is-secondary" onClick={() => void propose()} disabled={busy !== null || !selectedWorkspace}><Sparkles size={14} />Draft with Codex</button></div>
              {proposal && <div className="agentic-super-app-proposal-card"><div className="agentic-super-app-proposal-heading"><div><Sparkles size={15} /><strong>Structured proposal</strong></div><button className="agentic-super-app-mini-button" onClick={() => setProposal(null)} aria-label="Dismiss proposal"><X size={13} /></button></div><p>Review {proposal.tasks.length} proposed tasks before they become runnable.</p><div className="agentic-super-app-proposal-list">{proposal.tasks.map((task) => <div key={task.client_id}><span className="agentic-super-app-proposal-index">{task.client_id}</span><span><strong>{task.title}</strong><small>{task.depends_on.length ? `Depends on ${task.depends_on.join(', ')}` : 'No dependencies'}</small></span></div>)}</div>{proposal.warnings.map((warning) => <p key={warning} className="agentic-super-app-proposal-warning"><CircleAlert size={13} />{warning}</p>)}<button onClick={() => void acceptProposal()} disabled={busy !== null}><Check size={14} />Accept proposal into run</button></div>}
              <div className="agentic-super-app-dag-list">{detail.tasks.length ? detail.tasks.map((task, index) => <TaskNode key={task.id} task={task} index={index} selected={task.id === selectedTask?.id} dependencies={detail.dependencies.filter((dependency) => dependency.task_id === task.id).map((dependency) => detail.tasks.find((candidate) => candidate.id === dependency.depends_on_task_id)?.client_id ?? dependency.depends_on_task_id)} onSelect={() => setSelectedTaskId(task.id)} />) : <div className="agentic-super-app-run-board-empty"><Bot size={22} /><p>Add a task manually or draft a structured DAG.</p></div>}</div>
            </section>
            <aside className="agentic-super-app-run-inspector" aria-label="Selected task inspector"><div className="agentic-super-app-run-section-heading"><div><GitBranch size={15} /><h3>Inspector</h3></div></div>{selectedTask ? <TaskInspector task={selectedTask} detail={detail} onReview={review} reviewFeedback={reviewFeedback} setReviewFeedback={setReviewFeedback} /> : <p className="agentic-super-app-code-muted">Select a task to inspect its specification, worker lease, checkpoint, or review.</p>}</aside>
          </div>
          <section className="agentic-super-app-worker-lanes" aria-labelledby="agentic-super-app-worker-lanes-title"><div className="agentic-super-app-run-section-heading"><div><Bot size={15} /><h3 id="agentic-super-app-worker-lanes-title">Worker lanes</h3><span>{runningDispatches.length} active</span></div><span className="agentic-super-app-code-muted">Concurrency {detail.summary.active_dispatches}/{Math.min(detail.summary.concurrency_limit, detail.summary.host_concurrency_cap)}</span></div>{detail.dispatches.length ? <div className="agentic-super-app-worker-lane-grid">{detail.dispatches.slice(0, 8).map((dispatch) => <WorkerLane key={dispatch.id} dispatch={dispatch} task={detail.tasks.find((task) => task.id === dispatch.task_id)} />)}</div> : <p className="agentic-super-app-code-muted">Workers appear here after the run starts. Every worker receives an isolated managed worktree.</p>}</section>
          {pendingQuestion && <section className="agentic-super-app-run-question" aria-labelledby="agentic-super-app-question-title"><div><CircleAlert size={17} /><div><h3 id="agentic-super-app-question-title">Worker needs your input</h3><p>{pendingQuestion.prompt}</p></div></div><div className="agentic-super-app-run-question-form"><input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Answer the worker" aria-label="Worker answer" /><button onClick={() => { if (!detail) return; void runAction('answer', () => agenticSuperAppClient.answerCodeQuestion({ run_id: detail.summary.id, task_id: pendingQuestion.task_id, dispatch_id: pendingQuestion.dispatch_id, lease_generation: detail.dispatches.find((dispatch) => dispatch.id === pendingQuestion.dispatch_id)?.lease_generation ?? 0, answer })) }} disabled={busy !== null || !answer.trim()}><Send size={14} />Answer</button></div></section>}
          {detail.summary.state === 'draft' || detail.summary.state === 'ready' || detail.summary.state === 'blocked' ? <section className="agentic-super-app-add-task" aria-labelledby="agentic-super-app-add-task-title"><div className="agentic-super-app-run-section-heading"><div><Plus size={15} /><h3 id="agentic-super-app-add-task-title">Add manual task</h3></div><span className="agentic-super-app-code-muted">Use client IDs in dependencies</span></div><div className="agentic-super-app-add-task-grid"><label>Title<input value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} placeholder="e.g. Add persistence tests" /></label><label>Specification<textarea rows={2} value={taskSpecification} onChange={(event) => setTaskSpecification(event.target.value)} placeholder="Bounded implementation and validation instructions" /></label><label>Dependencies<select multiple value={taskDependencies} onChange={(event) => setTaskDependencies([...event.target.selectedOptions].map((option) => option.value))}>{detail.tasks.map((task) => <option key={task.id} value={task.id}>{task.client_id}</option>)}</select></label><button onClick={() => void addTask()} disabled={busy !== null || !taskTitle.trim() || !taskSpecification.trim()}><Plus size={14} />Add task</button></div></section> : null}
        </>}
      </main>
    </div>
  </section>
}

function TaskNode({ task, index, selected, dependencies, onSelect }: { task: CodeTask; index: number; selected: boolean; dependencies: string[]; onSelect: () => void }) {
  return <button className={`agentic-super-app-dag-node ${selected ? 'is-selected' : ''}`} onClick={onSelect} aria-pressed={selected}><span className="agentic-super-app-dag-index">{String(index + 1).padStart(2, '0')}</span><span className="agentic-super-app-dag-copy"><strong>{task.title}</strong><small>{task.client_id} · {task.state.replaceAll('_', ' ')}</small>{dependencies.length > 0 && <span className="agentic-super-app-dag-dependencies">{dependencies.map((dependency) => <span key={dependency}>← {dependency}</span>)}</span>}</span><span className={`agentic-super-app-task-status ${task.state}`} aria-label={`Task ${task.state}`} /></button>
}

function WorkerLane({ dispatch, task }: { dispatch: CodeDispatch; task?: CodeTask }) {
  return <article className="agentic-super-app-worker-lane"><div className="agentic-super-app-worker-lane-top"><span className="agentic-super-app-worker-pulse" aria-hidden="true" /><strong>{task?.title ?? 'Unknown task'}</strong><span className={`agentic-super-app-run-badge ${dispatch.state}`}>{dispatch.state.replaceAll('_', ' ')}</span></div><div className="agentic-super-app-worker-lane-meta"><span>Attempt {dispatch.attempt}</span><span>{dispatch.session_id ? 'resumable session' : 'new session'}</span><span>{dispatch.pid ? `PID ${dispatch.pid}` : 'awaiting process'}</span></div>{dispatch.result_summary && <p>{dispatch.result_summary}</p>}{dispatch.error && <p className="agentic-super-app-worker-error">{dispatch.error}</p>}</article>
}

function TaskInspector({ task, detail, onReview, reviewFeedback, setReviewFeedback }: { task: CodeTask; detail: CodeRunDetail; onReview: (decision: CodeReviewDecision) => Promise<void>; reviewFeedback: string; setReviewFeedback: (value: string) => void }) {
  const dispatch = detail.dispatches.find((candidate) => candidate.id === task.active_dispatch_id) ?? detail.dispatches.find((candidate) => candidate.task_id === task.id)
  const checkpoint = detail.checkpoints.find((candidate) => candidate.id === task.latest_checkpoint_id)
  const canReview = task.state === 'awaiting_review' && Boolean(task.latest_checkpoint_id)
  return <div className="agentic-super-app-task-inspector"><div className="agentic-super-app-task-inspector-title"><span className={`agentic-super-app-task-status ${task.state}`} /><div><h4>{task.title}</h4><p>{task.client_id} · attempt {task.attempt}</p></div></div><dl><div><dt>State</dt><dd>{task.state.replaceAll('_', ' ')}</dd></div><div><dt>Worker</dt><dd>{dispatch?.state.replaceAll('_', ' ') ?? 'not dispatched'}</dd></div><div><dt>Checkpoint</dt><dd>{checkpoint ? checkpoint.kind : 'none'}</dd></div><div><dt>Lease</dt><dd>{dispatch ? `generation ${dispatch.lease_generation}` : 'none'}</dd></div></dl><div className="agentic-super-app-task-spec"><span>Specification</span><p>{task.specification}</p></div>{task.error && <div className="agentic-super-app-task-error"><CircleAlert size={14} />{task.error}</div>}{canReview && <div className="agentic-super-app-review-form"><label htmlFor="agentic-super-app-review-feedback">Review feedback</label><textarea id="agentic-super-app-review-feedback" rows={3} value={reviewFeedback} onChange={(event) => setReviewFeedback(event.target.value)} placeholder="Optional acceptance notes or requested changes" /><div><button onClick={() => void onReview('accept')}><Check size={14} />Accept</button><button className="is-secondary" onClick={() => void onReview('request_changes')}><RotateCcw size={14} />Request changes</button><button className="is-danger" onClick={() => void onReview('reject')}><X size={14} />Reject</button></div></div>}</div>
}
