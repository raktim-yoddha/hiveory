import { memo, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, Dot, GitBranch, GitCommitHorizontal, GitCompareArrows, Loader2, Maximize2, Minus, Plus, RefreshCw, SquarePen, Undo2 } from 'lucide-react'
import type { ChangedFile, ChangeSource } from '@shared/domain/changes'
import { FileIcon } from '../../components/files/FileIcon'
import { IconButton } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { Menu } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { runAction } from '../../stores/notices'
import { buildChangeTree, shortCount, type ChangeNode } from './change-tree'
import { DiffView } from './DiffView'
import { openReview, useChangesView } from './changes-store'
import { useChangeSet } from './useChangeSet'
import { UNCOMMITTED, useChangeSource } from './useChangeSource'
import { CommitBar } from './CommitBar'
import styles from './ChangesPanel.module.css'

/** The worktree's change set for the source its views share. */
export function useChangeSetFor(workspaceId: string) {
  const source = useChangesView((s) => s.source[workspaceId]) ?? UNCOMMITTED
  return useChangeSet(workspaceId, source)
}

/** "+1.9k −684", green and red; nothing for an empty side. */
export function DiffStat({ additions, deletions, className }: { additions: number; deletions: number; className?: string }) {
  return (
    <span className={cx(styles.stat, className)} aria-label={`${additions} lines added, ${deletions} removed`}>
      <span className={styles.add}>+{shortCount(additions)}</span>
      <span className={styles.del}>−{shortCount(deletions)}</span>
    </span>
  )
}

/**
 * The side panel's Changes tab (ADR 0058): every file the agents (and you) changed in this worktree,
 * as a tree with line counts; a file opens its diff in place. Uncommitted work, the whole branch
 * against its base, one commit, or one chat turn.
 */
export function ChangesPanel({ workspaceId }: { workspaceId: string }) {
  const { changes, error, loading, refresh } = useChangeSetFor(workspaceId)
  const { source, choose, commits, items, label } = useChangeSource(workspaceId, changes)
  const [showCommits, setShowCommits] = useState(false)
  const tree = useMemo(() => buildChangeTree(changes?.files ?? []), [changes])

  return (
    <div className={styles.panel}>
      <div className={styles.bar}>
        <span className={styles.branch} title={changes?.branch ? `Branch ${changes.branch}` : undefined}>
          <GitBranch aria-hidden />
          <span className={styles.ellipsis}>{changes?.branch ?? '—'}</span>
        </span>
        <span className={styles.flex} />
        <IconButton label="Review every file in a pane" icon={<Maximize2 />} onClick={() => void openReview(workspaceId)} />
        <IconButton label="Refresh changes" icon={<RefreshCw className={loading ? 'spin' : undefined} />} onClick={() => void refresh()} />
      </div>
      <div className={styles.bar}>
        <Menu
          label="Which changes"
          items={items}
          trigger={(props) => (
            <button type="button" {...props} className={styles.source}>
              <span className={styles.ellipsis}>{label}</span>
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
              <TreeNode key={node.kind === 'folder' ? node.path : node.file.path} node={node} depth={0} workspaceId={workspaceId} source={source} onChanged={refresh} />
            ))}
          </ul>
        )}
      </div>
      <CommitBar workspaceId={workspaceId} changedFiles={source.kind === 'uncommitted' ? (changes?.files.length ?? 0) : 0} onDone={() => void refresh()} />
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
  /** After a file was discarded. */
  onChanged: () => Promise<void>
}

const TreeNode = memo(function TreeNode({ node, depth, workspaceId, source, onChanged }: TreeNodeProps) {
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
              <TreeNode key={child.kind === 'folder' ? child.path : child.file.path} node={child} depth={depth + 1} workspaceId={workspaceId} source={source} onChanged={onChanged} />
            ))}
          </ul>
        )}
      </li>
    )
  }
  return <FileRow file={node.file} name={node.name} depth={depth} workspaceId={workspaceId} source={source} onChanged={onChanged} />
})

function FileRow({ file, name, depth, workspaceId, source, onChanged }: { file: ChangedFile; name: string; depth: number; workspaceId: string; source: ChangeSource; onChanged: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [discarding, setDiscarding] = useState<'ask' | 'busy' | null>(null)
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
          <FileIcon name={file.path} className={styles.fileIcon} />
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
        {source.kind === 'uncommitted' && <IconButton className={styles.open} label={`Discard changes to ${name}`} icon={<Undo2 />} onClick={() => setDiscarding('ask')} />}
      </div>
      <ConfirmDialog
        open={discarding !== null}
        title={`Discard changes to ${name}?`}
        confirmLabel="Discard"
        danger
        busy={discarding === 'busy'}
        onClose={() => setDiscarding(null)}
        onConfirm={() => {
          setDiscarding('busy')
          void runAction('Discard changes', () => api('changes.discard', { workspaceId, paths: file.from ? [file.from, file.path] : [file.path] }))
            .then(onChanged)
            .finally(() => setDiscarding(null))
        }}
      >
        {file.status === 'added' ? 'This new file is deleted. It cannot be undone.' : 'The file goes back to how it is in the last commit. It cannot be undone.'}
      </ConfirmDialog>
      {open && (
        <div className={styles.diff} role="region" aria-label={`Changes in ${name}`}>
          {failed ? (
            <p className={styles.note}>{failed}</p>
          ) : patch === null ? (
            <div className={styles.loading}>
              <Loader2 className="spin" aria-hidden /> Loading diff…
            </div>
          ) : (
            <DiffView patch={patch} bounded />
          )}
        </div>
      )}
    </li>
  )
}
