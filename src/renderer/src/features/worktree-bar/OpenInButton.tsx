import { useEffect, useState } from 'react'
import { Copy } from 'lucide-react'
import type { EditorApp, OpenInApps, WorkspaceView } from '@shared/domain'
import { BrandMark } from '../../components/brand/BrandMark'
import { SplitButton } from '../../components/ui/SplitButton'
import type { MenuEntry } from '../../components/ui/Menu'
import { api } from '../../lib/api'
import { runAction } from '../../stores/notices'

const LAST_KEY = 'hiveory.lastEditor'
/** Installed editors don't change while Hiveory runs: asked once per window. */
let asked: Promise<OpenInApps | null> | null = null
const openInApps = (): Promise<OpenInApps | null> => (asked ??= api('system.editorApps').catch(() => null))

const readLast = (): string | null => {
  try {
    return localStorage.getItem(LAST_KEY)
  } catch {
    return null
  }
}

/**
 * Open in ▾ (ADR 0064): opens the worktree's folder in the editor used last (VS Code, Cursor, Zed…,
 * whichever are installed, each with its own mark); the menu offers the others, this system's file
 * manager and copying the path.
 */
export function OpenInButton({ workspace }: { workspace: WorkspaceView }) {
  const [apps, setApps] = useState<OpenInApps | null>(null)
  const [last, setLast] = useState(readLast)
  useEffect(() => {
    let live = true
    void openInApps().then((found) => live && setApps(found))
    return () => {
      live = false
    }
  }, [])

  const editors = apps?.editors ?? []
  const main = editors.find((a) => a.id === last) ?? editors[0]
  const open = (app: EditorApp): void => {
    try {
      localStorage.setItem(LAST_KEY, app.id)
    } catch {
      // The first editor stays the default.
    }
    setLast(app.id)
    void runAction(`Open in ${app.label}`, () => api('system.openIn', { workspaceId: workspace.id, appId: app.id }))
  }
  const reveal = (): void => void runAction('Open folder', () => api('system.revealPath', { workspaceId: workspace.id }))
  const items: MenuEntry[] = [
    ...editors.map((a) => ({ type: 'item' as const, id: a.id, label: a.label, icon: <BrandMark icon={a.icon} size="sm" />, checked: a.id === main?.id, onSelect: () => open(a) })),
    ...(editors.length ? [{ type: 'separator' as const }] : []),
    ...(apps
      ? [{ type: 'item' as const, id: 'reveal', label: apps.fileManager.label, icon: <BrandMark icon={apps.fileManager.icon} size="sm" />, disabled: !workspace.healthy, onSelect: reveal }]
      : []),
    { type: 'item', id: 'copy', label: 'Copy path', icon: <Copy />, onSelect: () => void runAction('Copy path', () => api('clipboard.writeText', { text: workspace.path })) }
  ]
  const shown = main ?? (apps ? { label: apps.fileManager.label, icon: apps.fileManager.icon } : null)
  return (
    <SplitButton
      icon={shown ? <BrandMark icon={shown.icon} size="sm" /> : <Copy />}
      label={shown?.label}
      title={main ? `Open this worktree in ${main.label}` : shown ? `Show this worktree in ${shown.label}` : 'Open this worktree'}
      onClick={main ? () => open(main) : apps ? reveal : undefined}
      menuLabel="Open this worktree in"
      items={items}
    />
  )
}
