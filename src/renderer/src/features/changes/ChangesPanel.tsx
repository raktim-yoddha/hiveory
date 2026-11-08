import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, Dot, FileCode2, GitBranch, GitCommitHorizontal, GitCompareArrows, Loader2, Minus, Plus, RefreshCw, SquarePen } from 'lucide-react'
import type { ChangedFile, ChangeSource, CommitSummary } from '@shared/domain/changes'
import { IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Menu, type MenuEntry } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { runAction } from '../../stores/notices'
import { buildChangeTree, diffLines, shortCount, type ChangeNode } from './change-tree'
import { useChangesView } from './changes-store'
import { useChangeSet } from './useChangeSet'
import styles from './ChangesPanel.module.css'

const UNCOMMITTED: ChangeSource = { kind: 'uncommitted' }

/** "+1.9k −684", green and red; nothing for an empty side. */
export function DiffStat({ additions, deletions, className }: { additions: number; deletions: number; className?: string }) {
  return (
    <span className={cx(styles.stat, className)} aria-label={`${additions} lines added, ${deletions} removed`}>
      <span className={styles.add}>+{shortCount(additions)}</span>
      <span className={styles.del}>−{shortCount(deletions)}</span>
    </span>
  )
}

const sourceLabel = (source: ChangeSource, commits: CommitSummary[]): string => {
  if (source.kind === 'uncommitted') return 'Uncommitted'
  if (source.kind === 'branch') return 'Branch'
  if (source.kind === 'turn') return 'One turn'
  return commits.find((c) => c.sha === source.sha)?.subject ?? source.sha.slice(0, 7)
}

/**
 * The side panel's Changes tab (ADR 0058): every file the agents (and you) changed in this worktree,
 * as a tree with line counts; a file opens its diff in place. Uncommitted work, the whole branch
 * against its base, one commit, or one chat turn.
 */
export function ChangesPanel({ workspaceId }: { workspaceId: string }) {
  const source = useChangesView((s) => s.source[workspaceId]) ?? UNCOMMITTED
  const setSource = useChangesView((s) => s.setSource)
  const { changes, error, loading, refresh } = useChangeSet(workspaceId, source)
  const [commits, setCommits] = useState<CommitSummary[]>([])
  const [showCommits, setShowCommits] = useState(false)
  const tree = useMemo(() => buildChangeTree(changes?.files ?? []), [changes])

  useEffect(() => {
    let live = true
    void api('changes.commits', { workspaceId })
      .then((list) => live && setCommits(list))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [workspaceId, changes?.branch])

  const choose = (next: ChangeSource): void => setSource(workspaceId, next)
  const items: MenuEntry[] = [
    { type: 'item', id: 'uncommitted', label: 'Uncommitted', hint: 'Everything not committed yet', checked: source.kind === 'uncommitted', onSelect: () => choose(UNCOMMITTED) },
    { type: 'item', id: 'branch', label: 'Branch', hint: changes?.base && source.kind === 'branch' ? `Against ${changes.base}` : 'Against its base branch', checked: source.kind === 'branch', onSelect: () => choose({ kind: 'branch' }) },
    ...(source.kind === 'turn' ? [{ type: 'item' as const, id: 'turn', label: 'One turn', hint: "A chat turn's own changes", checked: true, onSelect: () => undefined }] : []),
    ...(commits.length
      ? [
          { type: 'separator' as const },
          { type: 'label' as const, label: 'Commits' },
          ...commits.slice(0, 20).map((c) => ({
            type: 'item' as const,
            id: c.sha,
            label: c.subject || c.sha.slice(0, 7),
            hint: c.sha.slice(0, 7),
            checked: source.kind === 'commit' && source.sha === c.sha,
            onSelect: () => choose({ kind: 'commit', sha: c.sha })
          }))
        ]
      : [])
  ]

  return (
    <div className={styles.panel}>
      <div className={styles.bar}>
        <span className={styles.branch} title={changes?.branch ? `Branch ${changes.branch}` : undefined}>
          <GitBranch aria-hidden />
          <span className={styles.ellipsis}>{changes?.branch ?? '—'}</span>
        </span>
        <span className={styles.flex} />
        <IconButton label="Refresh changes" icon={<RefreshCw className={loading ? 'spin' : undefined} />} onClick={() => void refresh()} />
      </div>
      <div className={styles.bar}>
        <Menu
          label="Which changes"
          items={items}
          trigger={(props) => (
            <button type="button" {...props} className={styles.source}>
              <span className={styles.ellipsis}>{sourceLabel(source, commits)}</span>
              <ChevronDown aria-hidden />
            </button>
          )}
        />
        {changes && <DiffStat additions={changes.additions} deletions={changes.deletions} />}
        <span className={styles.flex} />
        {changes && changes.files.length > 0 && <span className={styles.count}>{changes.files.length} {changes.files.length === 1 ? 'file' : 'files'}</span>}
      </div>
      <div className={styles.body}>
        {error && !changes ? (
          <EmptyState compact icon={<GitCompareArrows />} title="Could not read the changes" description={error} />
        ) : !changes ? (
          <div className={styles.loading}>
            <Loader2 className="spin" aria-hidden /> Reading changes…
          </div>
        ) : changes.note ? (
          <EmptyState compact icon={<GitCompareArrows />} title="No changes to show" description={changes.note} />
        ) : changes.files.length === 0 ? (
          <EmptyState compact icon={<GitCompareArrows />} title="No changes" description={source.kind === 'uncommitted' ? 'Files the agents (or you) change here show up as they change.' : 'Nothing changed.'} />
        ) : (
          <ul className={styles.tree} role="tree" aria-label="Changed files">
            {tree.map((node) => (
              <TreeNode key={node.kind === 'folder' ? node.path : node.file.path} node={node} depth={0} workspaceId={workspaceId} source={source} />
            ))}
          </ul>
        )}
      </div>
      {commits.length > 0 && (
        <div className={styles.commits}>
          <button type="button" className={styles.commitsToggle} aria-expanded={showCommits} onClick={() => setShowCommits(!showCommits)}>
            {showCommits ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
            Commits
            <span className={styles.count}>{commits.length}</span>
          </button>
          {showCommits && (
            <ul className={styles.commitList}>
              {commits.map((c) => (
                <li key={c.sha}>
                  <button
                    type="button"
                    className={cx(styles.commit, source.kind === 'commit' && source.sha === c.sha && styles.selected)}
                    onClick={() => choose({ kind: 'commit', sha: c.sha })}
                    title={`${c.subject}\n${c.author} · ${new Date(c.date).toLocaleString()}`}
                  >
                    <GitCommitHorizontal aria-hidden />
                    <span className={styles.ellipsis}>{c.subject}</span>
                    <span className={styles.sha}>{c.sha.slice(0, 7)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

const STATUS_MARK = {
  added: { icon: Plus, label: 'Added' },
  modified: { icon: Dot, label: 'Modified' },
  deleted: { icon: Minus, label: 'Deleted' },
  renamed: { icon: ArrowRight, label: 'Renamed' }
} as const

interface TreeNodeProps {
  node: ChangeNode
  depth: number
  workspaceId: string
  source: ChangeSource
}

const TreeNode = memo(function TreeNode({ node, depth, workspaceId, source }: TreeNodeProps) {
  const [open, setOpen] = useState(true)
  const indent = { '--depth': depth } as CSSProperties
  if (node.kind === 'folder') {
    return (
      <li role="treeitem" aria-expanded={open}>
        <button type="button" className={styles.row} style={indent} onClick={() => setOpen(!open)}>
          {open ? <ChevronDown aria-hidden className={styles.chevron} /> : <ChevronRight aria-hidden className={styles.chevron} />}
          <span className={cx(styles.name, styles.ellipsis)}>{node.name}</span>
          <DiffStat additions={node.additions} deletions={node.deletions} />
        </button>
        {open && (
          <ul role="group" className={styles.tree}>
            {node.children.map((child) => (
              <TreeNode key={child.kind === 'folder' ? child.path : child.file.path} node={child} depth={depth + 1} workspaceId={workspaceId} source={source} />
            ))}
          </ul>
        )}
      </li>
    )
  }
  return <FileRow file={node.file} name={node.name} depth={depth} workspaceId={workspaceId} source={source} />
})

function FileRow({ file, name, depth, workspaceId, source }: { file: ChangedFile; name: string; depth: number; workspaceId: string; source: ChangeSource }) {
  const [open, setOpen] = useState(false)
  const [patch, setPatch] = useState<string | null>(null)
  const [failed, setFailed] = useState<string>()
  const mark = STATUS_MARK[file.status]
  const sourceKey = JSON.stringify(source)

  useEffect(() => {
    if (!open) return
    let live = true
    // The diff on screen stays until the new one arrives (no flash while an agent edits).
    void api('changes.diff', { workspaceId, source: JSON.parse(sourceKey) as ChangeSource, path: file.path })
      .then((text) => {
        if (!live) return
        setFailed(undefined)
        setPatch(text)
      })
      .catch((error: unknown) => live && setFailed(error instanceof Error ? error.message : String(error)))
    return () => {
      live = false
    }
    // Counts change as the agent edits: the open diff follows them.
  }, [open, workspaceId, sourceKey, file.path, file.additions, file.deletions])

  return (
    <li role="treeitem" aria-expanded={open}>
      <div className={styles.fileRow}>
        <button
          type="button"
          className={styles.row}
          style={{ '--depth': depth } as CSSProperties}
          onClick={() => setOpen(!open)}
          title={file.from ? `${file.from} → ${file.path}` : file.path}
        >
          <FileCode2 aria-hidden className={styles.fileIcon} />
          <span className={cx(styles.name, styles.ellipsis, file.status === 'deleted' && styles.deletedName)}>{name}</span>
          {file.binary ? <span className={styles.count}>binary</span> : <DiffStat additions={file.additions} deletions={file.deletions} />}
          <span className={cx(styles.mark, styles[file.status])} aria-label={mark.label} title={mark.label}>
            <mark.icon aria-hidden />
          </span>
        </button>
        {file.status !== 'deleted' && (
          <IconButton
            className={styles.open}
            label={`Open ${name}`}
            icon={<SquarePen />}
            onClick={() => void runAction('Open file', () => api('editors.open', { workspaceId, path: file.path }))}
          />
        )}
      </div>
      {open && (
        <div className={styles.diff} role="region" aria-label={`Changes in ${name}`}>
          {failed ? (
            <p className={styles.note}>{failed}</p>
          ) : patch === null ? (
            <div className={styles.loading}>
              <Loader2 className="spin" aria-hidden /> Loading diff…
            </div>
          ) : (
            <DiffView patch={patch} />
          )}
        </div>
      )}
    </li>
  )
}

const MAX_DIFF_LINES = 3000

/** A unified diff, colored by line; very long ones are cut. */
function DiffView({ patch }: { patch: string }) {
  const lines = useMemo(() => diffLines(patch), [patch])
  if (lines.length === 0) return <p className={styles.note}>No line changes.</p>
  return (
    <pre className={styles.code}>
      {lines.slice(0, MAX_DIFF_LINES).map((line, i) => (
        <span key={i} className={cx(styles.line, styles[line.kind])}>
          <span className={styles.sign} aria-hidden>
            {line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : ' '}
          </span>
          {line.text || ' '}
          {'\n'}
        </span>
      ))}
      {lines.length > MAX_DIFF_LINES && <span className={cx(styles.line, styles.note)}>… {lines.length - MAX_DIFF_LINES} more lines</span>}
    </pre>
  )
}
