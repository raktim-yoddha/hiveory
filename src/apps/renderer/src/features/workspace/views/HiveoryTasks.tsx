import { AlertCircle, CircleCheck, Filter, LoaderCircle, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { hiveoryClient, type CodeRunSummary, type CodeTask } from '../../../shared/api/hiveory-client'
import '../styles/workspace.css'

type LocalTask = CodeTask & { run: CodeRunSummary }

function taskStateLabel(state: CodeTask['state']) {
  return state.replaceAll('_', ' ')
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function HiveoryTasks({ onOpenWorkspace }: { onOpenWorkspace: (workspaceId: string) => void }) {
  const [tasks, setTasks] = useState<LocalTask[]>([])
  const [query, setQuery] = useState('')
  const [state, setState] = useState<'all' | CodeTask['state']>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const runs = await hiveoryClient.codeRuns()
      const details = await Promise.all(runs.map(async (run) => ({ run, detail: await hiveoryClient.codeRun(run.id) })))
      setTasks(details.flatMap(({ run, detail }) => detail.tasks.map((task) => ({ ...task, run }))).sort((left, right) => right.updated_at_unix_ms - left.updated_at_unix_ms))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Local tasks could not be loaded.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const visibleTasks = useMemo(() => {
    const term = query.trim().toLocaleLowerCase()
    return tasks.filter((task) => (state === 'all' || task.state === state) && (!term || [task.client_id, task.title, task.specification, task.run.title].some((value) => value.toLocaleLowerCase().includes(term))))
  }, [query, state, tasks])

  return (
    <section className="hiveory-tasks-page" aria-labelledby="hiveory-tasks-title">
      <header className="hiveory-tasks-header">
        <div><h1 id="hiveory-tasks-title">Tasks</h1><p>Tasks created in local Hiveory code runs. No account or remote service is required.</p></div>
        <button type="button" className="hiveory-icon-button" onClick={() => void refresh()} disabled={loading} title="Refresh tasks" aria-label="Refresh tasks"><RefreshCw size={15} className={loading ? 'is-spinning' : ''} /></button>
      </header>
      <div className="hiveory-tasks-toolbar">
        <label className="hiveory-tasks-filter"><Filter size={15} /><span>Status</span><select value={state} onChange={(event) => setState(event.target.value as typeof state)}><option value="all">All</option><option value="draft">Draft</option><option value="ready">Ready</option><option value="preparing">Preparing</option><option value="running">Running</option><option value="awaiting_input">Needs input</option><option value="awaiting_review">In review</option><option value="blocked">Blocked</option><option value="completed">Completed</option><option value="failed">Failed</option><option value="cancelled">Cancelled</option></select></label>
        <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search local tasks" placeholder="Search local tasks" />
      </div>
      <div className="hiveory-tasks-table" role="region" aria-label="Local tasks">
        <div className="hiveory-tasks-columns"><span>ID</span><span>Title / run</span><span>Workspace</span><span>Status</span><span>Updated</span></div>
        {loading ? <div className="hiveory-tasks-empty"><LoaderCircle className="is-spinning" size={22} /><p>Loading local tasks…</p></div> : error ? <div className="hiveory-tasks-empty"><AlertCircle size={22} /><h2>Tasks could not load</h2><p>{error}</p><button type="button" onClick={() => void refresh()}>Try again</button></div> : visibleTasks.length ? <div className="hiveory-tasks-rows">{visibleTasks.map((task) => <button key={task.id} type="button" className="hiveory-task-row" onClick={() => onOpenWorkspace(task.run.workspace_id)} title={`Open ${task.run.title}`}><span><code>{task.client_id}</code></span><span><strong>{task.title}</strong><small>{task.run.title}</small></span><span>{task.run.workspace_id.slice(0, 8)}</span><span className={`hiveory-task-state ${task.state}`}><CircleCheck size={13} />{taskStateLabel(task.state)}</span><time dateTime={new Date(task.updated_at_unix_ms).toISOString()}>{formatTime(task.updated_at_unix_ms)}</time></button>)}</div> : <div className="hiveory-tasks-empty"><CircleCheck size={22} /><h2>No local tasks match</h2><p>Create a code run or change the filter to see tasks here.</p></div>}
      </div>
    </section>
  )
}
