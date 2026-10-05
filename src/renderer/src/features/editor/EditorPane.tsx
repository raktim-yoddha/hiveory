import { useCallback, useEffect, useRef, useState } from 'react'
import { FileCode2, Maximize2, Minimize2, Save, X } from 'lucide-react'
import type { EditorView } from '@shared/domain'
import { IconButton } from '../../components/ui/Button'
import { ConfirmDialog } from '../../components/ui/ConfirmDialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { api, subscribe } from '../../lib/api'
import { runAction } from '../../stores/notices'
import { PaneFrame } from '../panes/PaneFrame'
import type { PaneRenderProps } from '../panes/PaneLayout'
import { CodeEditor } from './CodeEditor'
import styles from './Editor.module.css'

interface EditorPaneProps extends PaneRenderProps {
  editor: EditorView
}

type Loaded = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; saved: string; revision: number }

/**
 * A file open as a pane beside the agents: edit, Ctrl+S to save. When the
 * file changes on disk (an agent edited it) and there are no unsaved edits,
 * the pane reloads it.
 */
export function EditorPane({ editor, onDragHandlePointerDown, maximized, toggleMaximize }: EditorPaneProps) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const current = useRef('')
  const scope = { workspaceId: editor.workspaceId }

  const load = useCallback(
    () =>
      api('files.read', { scope: { workspaceId: editor.workspaceId }, path: editor.path }).then(
        ({ content }) => {
          current.current = content
          setLoaded((prev) => ({ state: 'ready', saved: content, revision: prev.state === 'ready' ? prev.revision + 1 : 0 }))
          setDirty(false)
        },
        (error: unknown) => setLoaded({ state: 'error', message: error instanceof Error ? error.message : String(error) })
      ),
    [editor.workspaceId, editor.path]
  )

  useEffect(() => {
    void load()
  }, [load])

  // An agent (or another app) changed the file: reload unless there are unsaved edits.
  const dirtyRef = useRef(dirty)
  useEffect(() => {
    dirtyRef.current = dirty
  }, [dirty])
  useEffect(
    () =>
      subscribe('files.changed', ({ scope: changed, paths }) => {
        if (changed === editor.workspaceId && !dirtyRef.current && paths.some((p) => p === editor.path || p === '')) void load()
      }),
    [editor.workspaceId, editor.path, load]
  )

  const save = async (): Promise<void> => {
    const content = current.current
    const ok = await runAction(`Save ${editor.name}`, () => api('files.write', { scope, path: editor.path, content }).then(() => true))
    if (ok) {
      setLoaded((prev) => (prev.state === 'ready' ? { ...prev, saved: content } : prev))
      setDirty(false)
    }
  }

  const close = (): void => void runAction('Close file', () => api('editors.close', { editorId: editor.id }))

  return (
    <PaneFrame
      label={`${editor.name} file`}
      onHeaderPointerDown={onDragHandlePointerDown}
      onHeaderDoubleClick={toggleMaximize}
      header={
        <>
          <span className={styles.identity} title={editor.path}>
            <FileCode2 aria-hidden className={styles.fileIcon} />
            <span className={styles.name}>{editor.name}</span>
            {dirty && <span className={styles.dirty} role="img" aria-label="Unsaved changes" />}
            <span className={styles.path} data-pane-optional="status">
              {editor.path.includes('/') ? editor.path.slice(0, editor.path.lastIndexOf('/')) : ''}
            </span>
          </span>
          <span className={styles.actions}>
            {dirty && <IconButton label={`Save ${editor.name}`} icon={<Save />} onClick={() => void save()} />}
            <IconButton
              data-pane-optional="maximize"
              label={maximized ? `Restore ${editor.name}` : `Maximize ${editor.name}`}
              icon={maximized ? <Minimize2 /> : <Maximize2 />}
              onClick={toggleMaximize}
            />
            <IconButton label={`Close ${editor.name}`} icon={<X />} onClick={() => (dirty ? setConfirmClose(true) : close())} />
          </span>
        </>
      }
    >
      {loaded.state === 'loading' ? null : loaded.state === 'error' ? (
        <EmptyState compact icon={<FileCode2 />} title="Can't open this file" description={loaded.message} />
      ) : (
        <CodeEditor
          value={loaded.saved}
          revision={loaded.revision}
          filename={editor.name}
          onChange={(value) => {
            current.current = value
            setDirty(value !== loaded.saved)
          }}
          onSave={() => void save()}
        />
      )}
      <ConfirmDialog
        open={confirmClose}
        title={`Close ${editor.name}?`}
        confirmLabel="Discard changes"
        danger
        onClose={() => setConfirmClose(false)}
        onConfirm={() => {
          setConfirmClose(false)
          close()
        }}
      >
        Your unsaved changes to this file will be lost.
      </ConfirmDialog>
    </PaneFrame>
  )
}
