import { useEffect, useState } from 'react'
import { Code2, Copy, FolderOpen } from 'lucide-react'
import type { EditorApp, WorkspaceView } from '@shared/domain'
import { SplitButton } from '../../components/ui/SplitButton'
import type { MenuEntry } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { runAction } from '../../stores/notices'

const LAST_KEY = 'hiveory.lastEditor'
/** Installed editors don't change while Hiveory runs; asked once per window. */
let installed: Promise<EditorApp[]> | null = null
const editorApps = (): Promise<EditorApp[]> => (installed ??= api('system.editorApps').catch(() => []))

const readLast = (): string | null => {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

/**
 * Open in ▾ (ADR 0064): opens the worktree's folder in the editor used last (VS Code, Cursor, Zed…,
 * whichever are installed); the menu offers the others, the file manager and copying the path.
 */
export function OpenInButton({ workspace }: { workspace: WorkspaceView }) {
  const [apps, setApps] = useState<EditorApp[]>([])
  const [last, setLast] = useState(readLast)
  useEffect(() => {
    let live = true
    void editorApps().then((list) => live && setApps(list))
    return () => {
      live = false
    }
  }, [])

  const main = apps.find((a) => a.id === last) ?? apps[0]
  const open = (app: EditorApp): void => {
    try {
      localStorage.setItem(LAST_KEY, app.id)
    } catch {
      // The first editor stays the default.
    }
    setLast(app.id)
    void runAction(`Open in ${app.label}`, () => api('system.openIn', { workspaceId: workspace.id, appId: app.id }))
  }
  const items: MenuEntry[] = [
    ...(apps.length ? [{ type: 'label' as const, label: 'Open in' }] : []),
    ...apps.map((a) => ({ type: 'item' as const, id: a.id, label: a.label, icon: <Code2 />, checked: a.id === main?.id, onSelect: () => open(a) })),
    ...(apps.length ? [{ type: 'separator' as const }] : []),
    { type: 'item', id: 'reveal', label: 'File manager', icon: <FolderOpen />, disabled: !workspace.healthy, onSelect: () => void runAction('Open folder', () => api('system.revealPath', { workspaceId: workspace.id })) },
    { type: 'item', id: 'copy', label: 'Copy path', icon: <Copy />, onSelect: () => void runAction('Copy path', () => api('clipboard.writeText', { text: workspace.path })) }
  ]
  return (
    <SplitButton
      icon={main ? <Code2 /> : <FolderOpen />}
      label={main?.label}
      title={main ? `Open this worktree in ${main.label}` : 'Open this worktree'}
      onClick={main ? () => open(main) : undefined}
      menuLabel="Open this worktree in"
      items={items}
    />
  )
}
