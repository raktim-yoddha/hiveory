import { useState } from 'react'
import { Pencil, Play, Plus } from 'lucide-react'
import type { Project } from '@shared/domain'
import { SplitButton } from '../../components/ui/SplitButton'
import type { MenuEntry } from '../../components/ui/Menu'
import { useNavigation } from '../../stores/navigation'
import { runScript } from '../agents/run-script'

const LAST_KEY = 'hiveory.lastScript'

const readLast = (projectId: string): string | undefined => {
  try {
    return (JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, string>)[projectId]
  } catch {
    return undefined
  }
}

const saveLast = (projectId: string, name: string): void => {
  try {
    localStorage.setItem(LAST_KEY, JSON.stringify({ ...(JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}') as Record<string, string>), [projectId]: name }))
  } catch {
    // Remembering is a convenience; the first script runs instead.
  }
}

/**
 * Run ▾ (ADR 0064): runs the Workspace script used last here (the first one at first) in a new
 * terminal tab; the menu lists every script and edits them in Workspace settings (ADR 0061).
 */
export function RunButton({ project, workspaceId }: { project: Project; workspaceId: string }) {
  const scripts = project.settings?.scripts ?? []
  const [last, setLast] = useState(() => readLast(project.id))
  const main = scripts.find((s) => s.name === last) ?? scripts[0]
  const run = (name: string): void => {
    const script = scripts.find((s) => s.name === name)
    if (!script) return
    saveLast(project.id, name)
    setLast(name)
    void runScript(workspaceId, project.id, script)
  }
  const edit = (): void => useNavigation.getState().openSettings('workspace', project.id)
  const items: MenuEntry[] = [
    ...(scripts.length ? [{ type: 'label' as const, label: 'Scripts' }] : []),
    ...scripts.map((s) => ({ type: 'item' as const, id: `run:${s.name}`, label: s.name, hint: s.command, icon: <Play />, checked: s.name === main?.name, onSelect: () => run(s.name) })),
    ...(scripts.length ? [{ type: 'separator' as const }] : []),
    { type: 'item', id: 'edit', label: scripts.length ? 'Edit scripts…' : 'Add a script…', icon: scripts.length ? <Pencil /> : <Plus />, onSelect: edit }
  ]
  return (
    <SplitButton
      icon={<Play />}
      title={main ? `Run ${main.name} (${main.command})` : 'Run a script: add one in Workspace settings'}
      onClick={main ? () => run(main.name) : undefined}
      menuLabel="Run a script"
      items={items}
    />
  )
}
