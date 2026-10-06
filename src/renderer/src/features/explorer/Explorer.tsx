import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  ChevronRight,
  ClipboardPaste,
  Copy,
  File,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderSearch,
  ListCollapse,
  Pencil,
  RefreshCw,
  Scissors,
  Search,
  Trash2
} from 'lucide-react'
import type { FileEntry } from '@shared/domain'
import { IconButton } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { Menu, type MenuEntry } from '../../components/ui/Menu'
import { api, subscribe } from '../../lib/api'
import { cx } from '../../lib/cx'
import { reportError, runAction } from '../../stores/notices'
import styles from './Explorer.module.css'

interface ExplorerProps {
  workspaceId: string
}

interface Row {
  entry: FileEntry
  depth: number
}

/** An inline name field: a new file/folder inside `dir`, or renaming `path`. */
type Draft = { kind: 'new-file' | 'new-dir'; dir: string } | { kind: 'rename'; path: string }

const parentOf = (path: string): string => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '')
const join = (dir: string, name: string): string => (dir ? `${dir}/${name}` : name)

/**
 * The folder in view as a tree, like an editor's file explorer: search,
 * create, rename, cut/copy/paste, delete (to the trash), copy paths. Double-
 * click a file to open it as a pane. Updates live while it is open.
 */
export function Explorer({ workspaceId }: ExplorerProps) {
  const scope = useMemo(() => ({ workspaceId }), [workspaceId])
  const scopeKey = workspaceId
  const [root, setRoot] = useState('')
  const [children, setChildren] = useState<Record<string, FileEntry[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(['']))
  const [selected, setSelected] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftName, setDraftName] = useState('')
  const [clipboard, setClipboard] = useState<{ mode: 'copy' | 'move'; paths: string[] } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<{ query: string; entries: FileEntry[] } | null>(null)
  // Results belong to the query they were found for; an empty query shows the tree.
  const results = query.trim() && found?.query === query.trim() ? found.entries : query.trim() ? [] : null
  const treeRef = useRef<HTMLDivElement>(null)

  const loadDir = useCallback(
    (dir: string) =>
      api('files.list', { scope, dir }).then(
        ({ root: folder, entries }) => {
          setRoot(folder)
          setChildren((c) => ({ ...c, [dir]: entries }))
        },
        (error: unknown) => {
          // A folder that vanished just disappears from the tree.
          setChildren((c) => {
            const next = { ...c }
            delete next[dir]
            return next
          })
          if (dir === '') reportError(error, 'Read folder')
        }
      ),
    [scope]
  )

  const refresh = useCallback(() => {
    for (const dir of expanded) void loadDir(dir)
  }, [expanded, loadDir])

  useEffect(() => {
    void loadDir('')
  }, [loadDir])

  // Live: watch the folder while the Explorer exists, refresh the folders on screen when it changes.
  const refreshRef = useRef(refresh)
  useEffect(() => {
    refreshRef.current = refresh
  }, [refresh])
  useEffect(() => {
    void api('files.watch', { scope, watch: true }).catch(() => undefined)
    const off = subscribe('files.changed', ({ scope: changed }) => changed === scopeKey && refreshRef.current())
    return () => {
      off()
      void api('files.watch', { scope, watch: false }).catch(() => undefined)
    }
  }, [scope, scopeKey])

  useEffect(() => {
    const q = query.trim()
    if (!q) return
    let live = true
    const timer = setTimeout(() => {
      void api('files.search', { scope, query: q })
        .then((entries) => live && setFound({ query: q, entries }))
        .catch(() => live && setFound({ query: q, entries: [] }))
    }, 150)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query, scope])

  const rows = useMemo(() => {
    const out: Row[] = []
    const walk = (dir: string, depth: number): void => {
      for (const entry of children[dir] ?? []) {
        out.push({ entry, depth })
        if (entry.kind === 'dir' && expanded.has(entry.path)) walk(entry.path, depth + 1)
      }
    }
    walk('', 0)
    return out
  }, [children, expanded])

  const toggle = (path: string): void => {
    setExpanded((s) => {
      const next = new Set(s)
      if (next.has(path)) next.delete(path)
      else {
        next.add(path)
        if (!children[path]) void loadDir(path)
      }
      return next
    })
  }

  const openFile = async (path: string): Promise<void> => {
    await runAction('Open file', () => api('editors.open', { workspaceId, path }))
  }

  const activate = (entry: FileEntry): void => {
    if (entry.kind === 'dir') toggle(entry.path)
    else void openFile(entry.path)
  }

  /** The folder an action targets: the selected folder, or the selected file's folder. */
  const targetDir = (path: string | null = selected): string => {
    if (path === null) return ''
    const entry = rows.find((r) => r.entry.path === path)?.entry
    return entry?.kind === 'dir' ? entry.path : parentOf(path)
  }

  const startDraft = (next: Draft): void => {
    if (next.kind !== 'rename' && next.dir) setExpanded((s) => new Set(s).add(next.dir))
    if (next.kind !== 'rename' && next.dir && !children[next.dir]) void loadDir(next.dir)
    setDraft(next)
    setDraftName(next.kind === 'rename' ? next.path.split('/').pop()! : '')
  }

  const commitDraft = async (): Promise<void> => {
    const current = draft
    const name = draftName.trim()
    setDraft(null)
    if (!current || !name || /[\\/]/.test(name)) return
    if (current.kind === 'rename') {
      const to = join(parentOf(current.path), name)
      if (to === current.path) return
      await runAction('Rename', () => api('files.rename', { scope, from: current.path, to }))
      setSelected(to)
    } else {
      const path = join(current.dir, name)
      const ok = await runAction(current.kind === 'new-dir' ? 'New folder' : 'New file', () =>
        api('files.create', { scope, path, kind: current.kind === 'new-dir' ? 'dir' : 'file' }).then(() => true)
      )
      if (ok) {
        setSelected(path)
        if (current.kind === 'new-file') void openFile(path)
      }
    }
    void loadDir(current.kind === 'rename' ? parentOf(current.path) : current.dir)
  }

  const paste = (dir: string): void => {
    if (!clipboard) return
    const { mode, paths } = clipboard
    void runAction('Paste', async () => {
      await api('files.paste', { scope, sources: paths, targetDir: dir, mode })
      if (mode === 'move') setClipboard(null)
      refresh()
      void loadDir(dir)
    })
  }

  const copyText = (text: string): void => void api('clipboard.writeText', { text }).catch(() => undefined)
  const absolute = (path: string): string => (root ? `${root.replace(/[\\/]+$/, '')}${root.includes('\\') ? '\\' : '/'}${path.split('/').join(root.includes('\\') ? '\\' : '/')}` : path)

  const menuFor = (entry: FileEntry | null): MenuEntry[] => {
    const dir = entry ? (entry.kind === 'dir' ? entry.path : parentOf(entry.path)) : ''
    return [
      { type: 'item', id: 'new-file', label: 'New file', icon: <FilePlus />, onSelect: () => startDraft({ kind: 'new-file', dir }) },
      { type: 'item', id: 'new-dir', label: 'New folder', icon: <FolderPlus />, onSelect: () => startDraft({ kind: 'new-dir', dir }) },
      { type: 'separator' },
      ...(entry
        ? [
            { type: 'item' as const, id: 'cut', label: 'Cut', icon: <Scissors />, hint: 'Ctrl+X', onSelect: () => setClipboard({ mode: 'move', paths: [entry.path] }) },
            { type: 'item' as const, id: 'copy', label: 'Copy', icon: <Copy />, hint: 'Ctrl+C', onSelect: () => setClipboard({ mode: 'copy', paths: [entry.path] }) }
          ]
        : []),
      { type: 'item', id: 'paste', label: 'Paste', icon: <ClipboardPaste />, hint: 'Ctrl+V', disabled: !clipboard, onSelect: () => paste(dir) },
      ...(entry
        ? [
            { type: 'separator' as const },
            { type: 'item' as const, id: 'copy-path', label: 'Copy path', onSelect: () => copyText(absolute(entry.path)) },
            { type: 'item' as const, id: 'copy-rel', label: 'Copy relative path', onSelect: () => copyText(entry.path) },
            { type: 'item' as const, id: 'reveal', label: 'Reveal in file manager', icon: <FolderSearch />, onSelect: () => void api('files.reveal', { scope, path: entry.path }).catch(() => undefined) },
            { type: 'separator' as const },
            { type: 'item' as const, id: 'rename', label: 'Rename', icon: <Pencil />, hint: 'F2', onSelect: () => startDraft({ kind: 'rename', path: entry.path }) },
            { type: 'item' as const, id: 'delete', label: 'Delete', icon: <Trash2 />, hint: 'Del', danger: true, onSelect: () => setDeleting(entry.path) }
          ]
        : [])
    ]
  }

  const onTreeKey = (event: KeyboardEvent): void => {
    if (draft || (event.target as HTMLElement).tagName === 'INPUT') return
    const index = rows.findIndex((r) => r.entry.path === selected)
    const row = rows[index]
    const focusRow = (i: number): void => {
      const next = rows[Math.max(0, Math.min(rows.length - 1, i))]
      if (!next) return
      setSelected(next.entry.path)
      treeRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(next.entry.path)}"]`)?.focus()
    }
    const mod = event.ctrlKey || event.metaKey
    if (event.key === 'ArrowDown') focusRow(index + 1)
    else if (event.key === 'ArrowUp') focusRow(index - 1)
    else if (event.key === 'ArrowRight' && row?.entry.kind === 'dir' && !expanded.has(row.entry.path)) toggle(row.entry.path)
    else if (event.key === 'ArrowLeft' && row) {
      if (row.entry.kind === 'dir' && expanded.has(row.entry.path)) toggle(row.entry.path)
      else focusRow(rows.findIndex((r) => r.entry.path === parentOf(row.entry.path)))
    } else if (event.key === 'Enter' && row) activate(row.entry)
    else if (event.key === 'F2' && row) startDraft({ kind: 'rename', path: row.entry.path })
    else if (event.key === 'Delete' && row) setDeleting(row.entry.path)
    else if (mod && event.key.toLowerCase() === 'c' && row) setClipboard({ mode: 'copy', paths: [row.entry.path] })
    else if (mod && event.key.toLowerCase() === 'x' && row) setClipboard({ mode: 'move', paths: [row.entry.path] })
    else if (mod && event.key.toLowerCase() === 'v') paste(targetDir())
    else return
    event.preventDefault()
  }

  const draftRow = (depth: number, kind: 'file' | 'dir') => (
    <div className={styles.row} style={{ paddingLeft: `calc(var(--space-4) + ${depth} * var(--space-6))` }}>
      <span className={styles.twisty} />
      {kind === 'dir' ? <Folder aria-hidden className={styles.icon} /> : <File aria-hidden className={styles.icon} />}
      <input
        className={styles.draft}
        autoFocus
        value={draftName}
        aria-label={kind === 'dir' ? 'Folder name' : 'File name'}
        spellCheck={false}
        onChange={(e) => setDraftName(e.target.value)}
        onFocus={(e) => {
          // Renaming selects the name without its extension, like an editor.
          const dot = e.target.value.lastIndexOf('.')
          e.target.setSelectionRange(0, dot > 0 ? dot : e.target.value.length)
        }}
        onBlur={() => void commitDraft()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commitDraft()
          if (e.key === 'Escape') setDraft(null)
          e.stopPropagation()
        }}
      />
    </div>
  )

  const cut = clipboard?.mode === 'move' ? new Set(clipboard.paths) : null
  const folderName = root.split(/[\\/]/).filter(Boolean).pop() ?? 'Folder'

  return (
    <div className={styles.explorer}>
      <div className={styles.bar}>
        <span className={styles.title} title={root}>
          {folderName}
        </span>
        <IconButton label="New file" icon={<FilePlus />} onClick={() => startDraft({ kind: 'new-file', dir: targetDir() })} />
        <IconButton label="New folder" icon={<FolderPlus />} onClick={() => startDraft({ kind: 'new-dir', dir: targetDir() })} />
        <IconButton label="Refresh" icon={<RefreshCw />} onClick={refresh} />
        <IconButton label="Collapse folders" icon={<ListCollapse />} onClick={() => setExpanded(new Set(['']))} />
      </div>
      <label className={styles.search}>
        <Search aria-hidden />
        <input value={query} placeholder="Search files" aria-label="Search files" spellCheck={false} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {results ? (
        <div className={styles.tree} role="list" aria-label="Search results">
          {results.length === 0 && <p className={styles.empty}>No files match.</p>}
          {results.map((entry) => (
            <button
              key={entry.path}
              type="button"
              role="listitem"
              className={styles.result}
              title={entry.path}
              onDoubleClick={() => void openFile(entry.path)}
              onKeyDown={(e) => e.key === 'Enter' && void openFile(entry.path)}
            >
              <File aria-hidden className={styles.icon} />
              <span className={styles.label}>{entry.name}</span>
              <span className={styles.dir}>{parentOf(entry.path)}</span>
            </button>
          ))}
        </div>
      ) : (
        <Menu
          label="Folder actions"
          context
          items={menuFor(null)}
          trigger={(props) => (
            <div className={styles.treeWrap}>
              <div ref={treeRef} className={styles.tree} role="tree" aria-label="Files" onKeyDown={onTreeKey}>
                {draft && draft.kind !== 'rename' && draft.dir === '' && draftRow(0, draft.kind === 'new-dir' ? 'dir' : 'file')}
                {rows.map(({ entry, depth }) => (
                  <div key={entry.path} role="none">
                    {draft?.kind === 'rename' && draft.path === entry.path ? (
                      draftRow(depth, entry.kind)
                    ) : (
                      <Menu
                        label={`${entry.name} actions`}
                        context
                        items={menuFor(entry)}
                        trigger={(rowProps) => (
                          <button
                            {...rowProps}
                            type="button"
                            role="treeitem"
                            aria-selected={selected === entry.path}
                            aria-expanded={entry.kind === 'dir' ? expanded.has(entry.path) : undefined}
                            data-path={entry.path}
                            tabIndex={selected === entry.path || (!selected && depth === 0) ? 0 : -1}
                            className={cx(styles.row, selected === entry.path && styles.selected, cut?.has(entry.path) && styles.cut)}
                            style={{ paddingLeft: `calc(var(--space-4) + ${depth} * var(--space-6))` }}
                            onClick={() => {
                              setSelected(entry.path)
                              if (entry.kind === 'dir') toggle(entry.path)
                            }}
                            onDoubleClick={() => entry.kind === 'file' && void openFile(entry.path)}
                            onContextMenu={(e) => {
                              e.stopPropagation()
                              setSelected(entry.path)
                              rowProps.onContextMenu?.(e)
                            }}
                          >
                            <span className={styles.twisty}>
                              {entry.kind === 'dir' && <ChevronRight aria-hidden className={cx(expanded.has(entry.path) && styles.open)} />}
                            </span>
                            {entry.kind === 'dir' ? (
                              expanded.has(entry.path) ? (
                                <FolderOpen aria-hidden className={styles.icon} />
                              ) : (
                                <Folder aria-hidden className={styles.icon} />
                              )
                            ) : (
                              <File aria-hidden className={styles.icon} />
                            )}
                            <span className={styles.label}>{entry.name}</span>
                          </button>
                        )}
                      />
                    )}
                    {draft && draft.kind !== 'rename' && entry.kind === 'dir' && draft.dir === entry.path && expanded.has(entry.path) &&
                      draftRow(depth + 1, draft.kind === 'new-dir' ? 'dir' : 'file')}
                  </div>
                ))}
                {rows.length === 0 && !draft && <p className={styles.empty}>This folder is empty.</p>}
              </div>
              {/* The empty area below the files: right-click for New file / New folder / Paste. */}
              <button
                ref={props.ref}
                type="button"
                className={styles.fill}
                aria-label="Folder actions"
                tabIndex={-1}
                onClick={() => setSelected(null)}
                onContextMenu={props.onContextMenu}
              />
            </div>
          )}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.split('/').pop()}?`}
        confirmLabel="Move to trash"
        danger
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const path = deleting
          setDeleting(null)
          if (!path) return
          void runAction('Delete', async () => {
            await api('files.delete', { scope, paths: [path] })
            if (selected === path) setSelected(null)
            void loadDir(parentOf(path))
          })
        }}
      >
        It moves to the trash, so you can restore it from there.
      </ConfirmDialog>
    </div>
  )
}
