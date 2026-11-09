import { memo, useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, GitCompareArrows, Loader2, RefreshCw, SquarePen } from 'lucide-react'
import type { ChangedFile, ChangeSource } from '@shared/domain/changes'
import type { EditorView } from '@shared/domain'
import { FileIcon } from '../../components/files/FileIcon'
import { IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { Menu } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { runAction } from '../../stores/notices'
import { PaneFrame } from '../panes/PaneFrame'
import { registerPaneCloser } from '../panes/pane-commands'
import type { PaneRenderProps } from '../panes/PaneLayout'
import { DiffStat, useChangeSetFor } from './ChangesPanel'
import { DiffView } from './DiffView'
import { useChangeSource } from './useChangeSource'
import styles from './ReviewPane.module.css'

interface ReviewPaneProps extends PaneRenderProps {
  editor: EditorView
  tabStrip: ReactNode
}

/**
 * The worktree's review pane (ADR 0064): every changed file's diff, one after another, with line
 * numbers, for reading a change whole the way a pull request shows it. Same changes as the Changes
 * tab (uncommitted, the branch, one commit or one turn); each file folds and opens in an editor.
 */
export function ReviewPane({ editor, onDragHandlePointerDown, toggleMaximize, tabStrip }: ReviewPaneProps) {
  const workspaceId = editor.workspaceId
  const { changes, error, loading, refresh } = useChangeSetFor(workspaceId)
  const { source, items, label } = useChangeSource(workspaceId, changes)
  // Folded files by path, for the source they were folded in: another source starts with every file open.
  const sourceKey = JSON.stringify(source)
  const [foldState, setFoldState] = useState<{ key: string; paths: ReadonlySet<string> }>({ key: sourceKey, paths: new Set() })
  const folded = foldState.key === sourceKey ? foldState.paths : new Set<string>()
  const setFolded = (update: (prev: ReadonlySet<string>) => ReadonlySet<string>): void => setFoldState({ key: sourceKey, paths: update(folded) })
  useEffect(() => registerPaneCloser(editor.id, () => void runAction('Close review', () => api('editors.close', { editorId: editor.id }))), [editor.id])

  const files = changes?.files ?? []
  const allFolded = files.length > 0 && files.every((f) => folded.has(f.path))
  const toggle = (path: string): void =>
    setFolded((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })

  return (
    <PaneFrame label="Review changes" onHeaderPointerDown={onDragHandlePointerDown} onHeaderDoubleClick={toggleMaximize} tabStrip={tabStrip}>
      <div className={styles.review}>
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
          {files.length > 0 && <span className={styles.count}>{files.length === 1 ? '1 file' : `${files.length} files`}</span>}
          <span className={styles.flex} />
          {files.length > 1 && (
            <IconButton
              label={allFolded ? 'Expand every file' : 'Collapse every file'}
              icon={allFolded ? <ChevronsUpDown /> : <ChevronsDownUp />}
              onClick={() => setFolded(() => (allFolded ? new Set() : new Set(files.map((f) => f.path))))}
            />
          )}
          <IconButton label="Refresh changes" icon={<RefreshCw className={loading ? 'spin' : undefined} />} onClick={() => void refresh()} />
        </div>
        <div className={styles.files}>
          {error && !changes ? (
            <EmptyState compact icon={<GitCompareArrows />} title="Could not read the changes" description={error} />
          ) : !changes ? (
            <div className={styles.loading}>
              <Loader2 className="spin" aria-hidden /> Reading changes…
            </div>
          ) : changes.note ? (
            <EmptyState compact icon={<GitCompareArrows />} title="No changes to show" description={changes.note} />
          ) : files.length === 0 ? (
            <EmptyState compact icon={<GitCompareArrows />} title="Nothing to review" description={source.kind === 'uncommitted' ? 'Files the agents (or you) change here show up as they change.' : 'Nothing changed.'} />
          ) : (
            files.map((file) => <FileDiff key={file.path} file={file} workspaceId={workspaceId} source={source} sourceKey={sourceKey} folded={folded.has(file.path)} onToggle={toggle} />)
          )}
        </div>
      </div>
    </PaneFrame>
  )
}

interface FileDiffProps {
  file: ChangedFile
  workspaceId: string
  source: ChangeSource
  sourceKey: string
  folded: boolean
  onToggle(path: string): void
}

/** One file's header and diff; the diff is read once the file scrolls near the screen. */
const FileDiff = memo(function FileDiff({ file, workspaceId, sourceKey, folded, onToggle }: FileDiffProps) {
  const ref = useRef<HTMLElement>(null)
  const [near, setNear] = useState(false)
  const [patch, setPatch] = useState<string | null>(null)
  const [failed, setFailed] = useState<string>()
  const slash = file.path.lastIndexOf('/')
  const name = file.path.slice(slash + 1)
  const dir = slash > 0 ? file.path.slice(0, slash) : ''

  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && setNear(true), { rootMargin: '600px 0px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [near])

  useEffect(() => {
    if (!near || folded || file.binary) return
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
  }, [near, folded, workspaceId, sourceKey, file.path, file.binary, file.additions, file.deletions])

  return (
    <section ref={ref} className={styles.file} aria-label={file.path}>
      <header className={styles.fileHeader}>
        <button type="button" className={styles.fileToggle} aria-expanded={!folded} onClick={() => onToggle(file.path)} title={file.from ? `${file.from} → ${file.path}` : file.path}>
          {folded ? <ChevronRight aria-hidden className={styles.chevron} /> : <ChevronDown aria-hidden className={styles.chevron} />}
          <FileIcon name={file.path} className={styles.fileIcon} />
          <span className={cx(styles.fileName, file.status === 'deleted' && styles.deleted)}>{name}</span>
          {dir && <span className={styles.fileDir}>{dir}</span>}
          {file.status === 'added' && <span className={styles.tag}>New</span>}
          {file.status === 'deleted' && <span className={styles.tag}>Deleted</span>}
          {file.status === 'renamed' && <span className={styles.tag}>Renamed</span>}
        </button>
        {file.binary ? <span className={styles.count}>binary</span> : <DiffStat additions={file.additions} deletions={file.deletions} />}
        {file.status !== 'deleted' && (
          <IconButton label={`Open ${name}`} icon={<SquarePen />} onClick={() => void runAction('Open file', () => api('editors.open', { workspaceId, path: file.path }))} />
        )}
      </header>
      {!folded && !file.binary && (
        <div className={styles.fileBody}>
          {failed ? (
            <p className={styles.note}>{failed}</p>
          ) : patch === null ? (
            <div className={styles.loading}>
              <Loader2 className="spin" aria-hidden /> Loading diff…
            </div>
          ) : (
            <DiffView patch={patch} numbered />
          )}
        </div>
      )}
    </section>
  )
})
