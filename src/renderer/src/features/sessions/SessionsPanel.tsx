import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, Copy, Ellipsis, History, Play, RefreshCw, Search } from 'lucide-react'
import type { AgentSession, SessionScope } from '@shared/domain'
import { CliLogo } from '../../components/cli/CliLogo'
import { Button, IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Menu } from '../../components/ui/Menu'
import { Tabs } from '../../components/ui/Tabs'
import { TextInput } from '../../components/ui/TextField'
import { api, toAppError } from '../../lib/api'
import { cx } from '../../lib/cx'
import { useClis, useWorkspaces } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { agentActions } from '../agents/agent-actions'
import styles from './Sessions.module.css'

const PAGE = 40
const SCOPES: Array<{ value: SessionScope; label: string }> = [
  { value: 'workspace', label: 'Worktree' },
  { value: 'project', label: 'Workspace' },
  { value: 'all', label: 'All' }
]

/** "3m ago", "2h ago", "4d ago", then a date. */
const ago = (iso: string): string => {
  const minutes = (Date.now() - Date.parse(iso)) / 60_000
  if (!Number.isFinite(minutes)) return ''
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${Math.floor(minutes)}m ago`
  if (minutes < 60 * 24) return `${Math.floor(minutes / 60)}h ago`
  if (minutes < 60 * 24 * 30) return `${Math.floor(minutes / 1440)}d ago`
  return new Date(iso).toLocaleDateString()
}

const folderName = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
const samePath = (a: string, b: string): boolean => a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()

/**
 * The agent CLIs' own conversation history (side panel › Sessions): every Claude
 * Code, Codex and Gemini session on this computer, for this workspace, this
 * project or everything. Read from the CLIs' files, so it survives restarts and
 * reboots. A session that ran in one of this project's workspaces resumes there
 * as a new pane.
 */
export function SessionsPanel({ projectId, workspaceId }: { projectId?: string; workspaceId?: string }) {
  const [scope, setScope] = useState<SessionScope>(workspaceId ? 'workspace' : 'project')
  const [sessions, setSessions] = useState<AgentSession[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [query, setQuery] = useState('')
  const [shown, setShown] = useState(PAGE)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [open, setOpen] = useState<string | null>(null)
  const clis = useClis((s) => s.clis)
  const workspaces = useWorkspaces((s) => (projectId ? s.byProject[projectId] : undefined))
  const openWorkspace = useNavigation((s) => s.openWorkspace)

  const [tick, setTick] = useState(0)

  useEffect(() => {
    let live = true
    api('sessions.list', { scope, workspaceId, projectId })
      .then((list) => live && (setSessions(list), setError(null)))
      .catch((e: unknown) => live && setError(toAppError(e).message))
      .finally(() => live && setLoading(false))
    return () => {
      live = false
    }
  }, [scope, workspaceId, projectId, tick])

  const refresh = (): void => {
    setLoading(true)
    setTick((n) => n + 1)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (sessions ?? []).filter((s) => !q || s.title.toLowerCase().includes(q) || s.preview?.text.toLowerCase().includes(q) || s.model?.toLowerCase().includes(q))
  }, [sessions, query])

  // Grouped by the folder each session ran in, newest group first.
  const groups = useMemo(() => {
    const map = new Map<string, AgentSession[]>()
    for (const s of filtered.slice(0, shown)) map.set(s.cwd, [...(map.get(s.cwd) ?? []), s])
    return [...map.entries()]
  }, [filtered, shown])

  /** The workspace of this project a session ran in: it resumes there. */
  const homeOf = (s: AgentSession) => workspaces?.find((w) => samePath(w.path, s.cwd))
  const resume = async (s: AgentSession): Promise<void> => {
    const home = homeOf(s)
    if (!home || !projectId) return
    openWorkspace(projectId, home.id)
    await agentActions.open(home.id, s.cliId, undefined, s.id)
  }

  return (
    <div className={styles.sessions}>
      <div className={styles.head}>
        <div className={styles.heading}>
          <span className={styles.title}>Agent sessions</span>
          <span className={styles.subtitle}>History kept by each CLI on this computer</span>
        </div>
        <IconButton label="Refresh sessions" icon={<RefreshCw className={cx(loading && 'spin')} />} onClick={refresh} />
      </div>
      <div className={styles.controls}>
        <Tabs label="Which sessions" variant="segmented" options={SCOPES} value={scope} onChange={(v) => (setScope(v), setShown(PAGE))} className={styles.scopes} />
        <label className={styles.search}>
          <Search aria-hidden />
          <TextInput aria-label="Search sessions" placeholder="Search sessions" value={query} onChange={setQuery} />
        </label>
      </div>
      {sessions && (
        <div className={styles.count}>
          {filtered.length === sessions.length ? `${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}` : `${filtered.length} of ${sessions.length} sessions`}
          <span className={styles.sort}>Last updated</span>
        </div>
      )}
      <div className={styles.list}>
        {error ? (
          <EmptyState compact icon={<History />} title="Couldn’t read the history" description={error} />
        ) : !sessions ? null : scope === 'workspace' && !workspaceId ? (
          <EmptyState compact icon={<History />} title="No worktree open" description="Open a worktree, or switch to Workspace or All." />
        ) : filtered.length === 0 ? (
          <EmptyState
            compact
            icon={<History />}
            title={query ? 'Nothing matches' : 'No sessions yet'}
            description={query ? `No session mentions “${query}”.` : 'Conversations with Claude Code, Codex and Gemini CLI show up here.'}
          />
        ) : (
          groups.map(([cwd, list]) => {
            const folded = collapsed.has(cwd)
            return (
              <section key={cwd} className={styles.group}>
                <button
                  type="button"
                  className={styles.groupHead}
                  aria-expanded={!folded}
                  title={cwd}
                  onClick={() => setCollapsed((c) => (c.has(cwd) ? new Set([...c].filter((x) => x !== cwd)) : new Set([...c, cwd])))}
                >
                  <ChevronDown aria-hidden className={cx(styles.chevron, folded && styles.folded)} />
                  <span className={styles.groupName}>{folderName(cwd)}</span>
                  <span className={styles.groupCount}>{filtered.filter((s) => s.cwd === cwd).length}</span>
                </button>
                {!folded &&
                  list.map((s) => {
                    const key = `${s.cliId}:${s.id}`
                    const home = homeOf(s)
                    const cli = clis.find((c) => c.id === s.cliId)
                    const canResume = Boolean(home && cli?.available && cli.resumesById)
                    const why = !cli?.available ? `${cli?.displayName ?? s.cliId} isn’t installed` : !home ? 'Ran in a folder outside this workspace' : undefined
                    return (
                      <article key={key} className={cx(styles.row, open === key && styles.open)}>
                        <button type="button" className={styles.rowMain} aria-expanded={open === key} onClick={() => setOpen(open === key ? null : key)}>
                          <span className={styles.rowTitle}>{s.title}</span>
                          {s.preview && (
                            <span className={styles.preview}>
                              <b>{s.preview.from === 'you' ? 'You' : 'Agent'}:</b> {s.preview.text}
                            </span>
                          )}
                          <span className={styles.meta}>
                            <CliLogo cliId={s.cliId} size="sm" />
                            <span>{cli?.displayName ?? s.cliId}</span>
                            <span aria-hidden>·</span>
                            <time dateTime={s.updatedAt} title={new Date(s.updatedAt).toLocaleString()}>
                              {ago(s.updatedAt)}
                            </time>
                            {s.model && (
                              <>
                                <span aria-hidden>·</span>
                                <span className={styles.model}>{s.model}</span>
                              </>
                            )}
                          </span>
                        </button>
                        <Menu
                          label="Session"
                          align="end"
                          items={[
                            { type: 'item', id: 'resume', label: home ? `Resume in ${home.name}` : 'Resume', icon: <Play />, disabled: !canResume, hint: why, onSelect: () => void resume(s) },
                            { type: 'item', id: 'copy', label: 'Copy session ID', icon: <Copy />, onSelect: () => void navigator.clipboard.writeText(s.id) }
                          ]}
                          trigger={(props) => <IconButton {...props} label={`More for ${s.title}`} icon={<Ellipsis />} className={styles.more} />}
                        />
                        {open === key && (
                          <div className={styles.details}>
                            <dl>
                              <dt>Folder</dt>
                              <dd title={s.cwd}>{s.cwd}</dd>
                              {s.startedAt && (
                                <>
                                  <dt>Started</dt>
                                  <dd>{new Date(s.startedAt).toLocaleString()}</dd>
                                </>
                              )}
                              <dt>Session</dt>
                              <dd className={styles.mono}>{s.id}</dd>
                            </dl>
                            <Button size="sm" variant="primary" icon={<Play />} disabled={!canResume} title={why} onClick={() => void resume(s)}>
                              {home ? `Resume in ${home.name}` : 'Resume'}
                            </Button>
                          </div>
                        )}
                      </article>
                    )
                  })}
              </section>
            )
          })
        )}
        {filtered.length > shown && (
          <button type="button" className={styles.showMore} onClick={() => setShown((n) => n + PAGE)}>
            Show more sessions
          </button>
        )}
      </div>
    </div>
  )
}
