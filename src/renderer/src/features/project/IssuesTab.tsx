import { useCallback, useEffect, useState } from 'react'
import { CircleDot, ExternalLink, GitBranchPlus, RefreshCw } from 'lucide-react'
import { CODE_HOST_INFO, TRACKER_INFO, type Issue, type IssueList } from '@shared/domain/integrations'
import { slugify } from '@shared/naming/names'
import { Button, IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { TextInput } from '../../components/ui/TextField'
import { api } from '../../lib/api'
import { useNavigation } from '../../stores/navigation'
import { CreateWorkspaceDialog } from '../workspace-create/CreateWorkspaceDialog'
import styles from './ProjectScreen.module.css'
import list from './PullRequests.module.css'

const sourceName = (source: IssueList['source']): string =>
  !source ? 'Issues' : source === 'github' || source === 'gitlab' ? CODE_HOST_INFO[source].name : TRACKER_INFO[source].name

/**
 * The Workspace's open issues (ADR 0040), from its code host, Jira or Linear as its settings say.
 * Any issue starts a worktree named after it, with the issue attached.
 */
export function IssuesTab({ projectId, local }: { projectId: string; local: boolean }) {
  const openProject = useNavigation((s) => s.openProject)
  const [data, setData] = useState<IssueList | null>(null)
  const [query, setQuery] = useState('')
  const [starting, setStarting] = useState<Issue | null>(null)

  const load = useCallback(async (): Promise<void> => {
    setData(await api('issues.list', { projectId }).catch(() => ({ issues: [], reason: 'Could not load issues.' })))
  }, [projectId])

  useEffect(() => {
    let live = true
    void api('issues.list', { projectId })
      .catch(() => ({ issues: [], reason: 'Could not load issues.' }) as IssueList)
      .then((next) => live && setData(next))
    return () => {
      live = false
    }
  }, [projectId])

  const q = query.trim().toLowerCase()
  const shown = (data?.issues ?? []).filter((i) => !q || i.key.toLowerCase().includes(q) || i.title.toLowerCase().includes(q))

  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <div>
          <h2 className={styles.sectionTitle}>Issues{data?.source ? ` · ${sourceName(data.source)}` : ''}</h2>
          <p className={styles.muted}>Open issues. Start a worktree from one to work on it apart from the rest.</p>
        </div>
        <IconButton label="Refresh issues" icon={<RefreshCw />} onClick={() => void load()} />
      </div>
      {!data ? (
        <EmptyState compact icon={<CircleDot />} title="Loading issues…" />
      ) : data.reason ? (
        <EmptyState
          compact
          icon={<CircleDot />}
          title="No issues to show"
          description={data.reason}
          actions={
            <Button size="sm" onClick={() => openProject(projectId, 'settings')}>
              Issue settings
            </Button>
          }
        />
      ) : data.issues.length === 0 ? (
        <EmptyState compact icon={<CircleDot />} title="No open issues" description={`Nothing open in ${sourceName(data.source)}.`} />
      ) : (
        <>
          {data.issues.length > 8 && <TextInput type="search" aria-label="Filter issues" placeholder="Filter by key or title" value={query} onChange={setQuery} />}
          <ul className={list.list}>
            {shown.map((issue) => (
              <li key={issue.key} className={list.row}>
                <span className={list.rowMain}>
                  <span className={list.rowTitle}>{issue.title}</span>
                  <span className={list.muted}>
                    {issue.key}
                    {issue.state ? ` · ${issue.state}` : ''}
                  </span>
                </span>
                {local && (
                  <Button size="sm" variant="ghost" icon={<GitBranchPlus />} onClick={() => setStarting(issue)}>
                    Start worktree
                  </Button>
                )}
                <a className={list.link} href={issue.url} target="_blank" rel="noreferrer" aria-label={`Open ${issue.key} in ${sourceName(data.source)}`}>
                  <ExternalLink aria-hidden />
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
      {starting && (
        <CreateWorkspaceDialog
          projectId={projectId}
          initial={{ name: slugify(`${starting.key} ${starting.title}`), association: { kind: 'issue', ref: `${starting.key} ${starting.title}`.slice(0, 300) } }}
          onClose={() => setStarting(null)}
        />
      )}
    </div>
  )
}
