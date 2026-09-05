import { ChevronRight, GripVertical, Pin, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { hiveoryClient, type CodeRunSummary, type CodeTask, type TaskBoardPreferences, type TaskBoardStatus } from '../../../shared/api/hiveory-client'

type BoardStatus = TaskBoardStatus
type BoardTask = CodeTask & { run: CodeRunSummary }
const emptyPreferences: TaskBoardPreferences = { statuses: {}, pinned: [] }

const statusDefinitions: Array<{ id: BoardStatus; label: string; color: string }> = [
  { id: 'todo', label: 'Todo', color: '#7c818a' },
  { id: 'in_progress', label: 'In progress', color: '#d7b900' },
  { id: 'in_review', label: 'In review', color: '#16a96b' },
  { id: 'done', label: 'Done', color: '#d4a892' },
]

function inferredStatus(task: CodeTask): BoardStatus {
  if (task.state === 'completed') return 'done'
  if (task.state === 'awaiting_review') return 'in_review'
  if (task.state === 'running' || task.state === 'preparing') return 'in_progress'
  return 'todo'
}

export function HiveoryWorkspaceBoard({ onOpenWorkspace, onClose }: { onOpenWorkspace: (workspaceId: string) => void; onClose: () => void }) {
  const [preferences, setPreferences] = useState<TaskBoardPreferences>(emptyPreferences)
  const [tasks, setTasks] = useState<BoardTask[]>([])
  const [query, setQuery] = useState('')
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [pinnedExpanded, setPinnedExpanded] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [runs, storedPreferences] = await Promise.all([hiveoryClient.codeRuns(), hiveoryClient.taskBoardPreferences()])
      const details = await Promise.all(runs.map(async (run) => ({ run, detail: await hiveoryClient.codeRun(run.id) })))
      setTasks(details.flatMap(({ run, detail }) => detail.tasks.map((task) => ({ ...task, run }))))
      setPreferences(storedPreferences)
      setFeedback(null)
    } catch (error) { setFeedback(error instanceof Error ? error.message : 'The local task board could not be loaded.') } finally { setLoading(false) }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const visibleTasks = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return tasks.filter((task) => !term || [task.client_id, task.title, task.run.title].some((value) => value.toLocaleLowerCase().includes(term)))
  }, [query, tasks])
  const persistPreferences = (mutate: (current: TaskBoardPreferences) => TaskBoardPreferences) => {
    setPreferences((current) => {
      const next = mutate(current)
      void hiveoryClient.updateTaskBoardPreferences(next).then(setPreferences).catch((error: unknown) => setFeedback(error instanceof Error ? error.message : 'The board change could not be saved.'))
      return next
    })
  }
  const setStatus = (taskId: string, status: BoardStatus) => persistPreferences((current) => ({ ...current, statuses: { ...current.statuses, [taskId]: status } }))
  const togglePinned = (taskId: string) => persistPreferences((current) => ({ ...current, pinned: current.pinned.includes(taskId) ? current.pinned.filter((id) => id !== taskId) : [...current.pinned, taskId] }))
  const pinnedTasks = visibleTasks.filter((task) => preferences.pinned.includes(task.id))

  return <section className="hiveory-workspace-board" role="dialog" aria-modal="true" aria-label="Task board">
    <header className="hiveory-workspace-board-header"><h1>Workspace board</h1><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search local tasks" aria-label="Search local tasks" /><div className="hiveory-workspace-board-actions"><button type="button" title="Refresh board" aria-label="Refresh board" onClick={() => void refresh()}><RefreshCw size={16} className={loading ? 'is-spinning' : ''} /></button><button type="button" title="Close board" aria-label="Close board" onClick={onClose}><X size={17} /></button></div></header>
    <div className={`hiveory-workspace-board-pinned ${pinnedExpanded ? 'is-expanded' : ''}`}><button type="button" onClick={() => setPinnedExpanded((value) => !value)} aria-expanded={pinnedExpanded}><Pin size={14} /><strong>Pinned</strong><span>{pinnedTasks.length ? `${pinnedTasks.length} task${pinnedTasks.length === 1 ? '' : 's'} pinned` : 'Drop here or use a card pin.'}</span><ChevronRight size={15} /></button>{pinnedExpanded && <div className="hiveory-workspace-board-pinned-items">{pinnedTasks.length ? pinnedTasks.map((task) => <button type="button" key={task.id} onClick={() => onOpenWorkspace(task.run.workspace_id)}>{task.title}<small>{task.run.title}</small></button>) : <span>No pinned local tasks.</span>}</div>}</div>
    <div className="hiveory-workspace-board-lanes">{statusDefinitions.map((status) => {
      const cards = visibleTasks.filter((task) => (preferences.statuses[task.id] ?? inferredStatus(task)) === status.id)
      return <section key={status.id} className="hiveory-workspace-board-lane" style={{ '--board-status-color': status.color } as CSSProperties} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggingId) setStatus(draggingId, status.id); setDraggingId(null) }}><header><span className="hiveory-board-status-dot" /><strong>{status.label}</strong><span>{cards.length}</span></header><div className="hiveory-workspace-board-cards">{cards.map((task) => <article key={task.id} className="hiveory-workspace-board-card" draggable onDragStart={() => setDraggingId(task.id)} onDoubleClick={() => onOpenWorkspace(task.run.workspace_id)}><button type="button" aria-label={`Open ${task.title}`} onClick={() => onOpenWorkspace(task.run.workspace_id)}><span className={`code-live-dot ${task.state === 'failed' || task.state === 'blocked' ? 'is-offline' : ''}`} />{task.title}</button><small>{task.client_id} · {task.run.title}</small><div><span>{task.state.replaceAll('_', ' ')}</span><button type="button" aria-label="Pin task" onClick={() => togglePinned(task.id)}><Pin size={13} fill={preferences.pinned.includes(task.id) ? 'currentColor' : 'none'} /></button><GripVertical size={14} /></div></article>)}{!cards.length && <div className="hiveory-workspace-board-empty">{loading ? 'Loading…' : 'Empty'}</div>}</div></section>
    })}</div>
    {feedback && <div className="hiveory-feedback" role="status">{feedback}</div>}
  </section>
}
