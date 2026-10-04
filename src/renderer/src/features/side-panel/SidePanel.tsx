import { useEffect, useState } from 'react'
import { Globe, RotateCcw, SquareTerminal, X } from 'lucide-react'
import { IconButton } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { PathTrail } from '../../components/ui/PathTrail'
import { api } from '../../lib/api'
import { cx } from '../../lib/cx'
import { selectedProjectId, selectedWorkspaceId, useNavigation, type RightPanel } from '../../stores/navigation'
import { reportError } from '../../stores/notices'
import { TerminalView } from '../terminal/TerminalView'
import styles from './SidePanel.module.css'

/**
 * Right side panel, like other agent IDEs: a real shell for the current
 * workspace, and the browser (coming soon).
 */
export function SidePanel({ panel }: { panel: RightPanel }) {
  const { toggleRightPanel } = useNavigation()
  return (
    <aside className={styles.panel} aria-label="Side panel">
      <header className={styles.header}>
        <div className={styles.tabs} role="tablist" aria-label="Side panel">
          <button
            type="button"
            role="tab"
            aria-selected={panel === 'terminal'}
            className={cx(styles.tab, panel === 'terminal' && styles.active)}
            onClick={() => panel !== 'terminal' && toggleRightPanel('terminal')}
          >
            <SquareTerminal /> Terminal
          </button>
          <button type="button" role="tab" aria-selected={false} aria-disabled className={styles.tab} disabled title="Built-in browser is coming soon">
            <Globe /> Browser <span className={styles.soon}>Soon</span>
          </button>
        </div>
        <IconButton label="Close side panel" icon={<X />} onClick={() => toggleRightPanel(panel)} />
      </header>
      <div className={styles.body}>
        <ErrorBoundary region="Terminal" compact>
          <ShellTab />
        </ErrorBoundary>
      </div>
    </aside>
  )
}

function ShellTab() {
  const view = useNavigation((s) => s.view)
  const workspaceId = selectedWorkspaceId(view)
  const projectId = selectedProjectId(view)
  const [shell, setShell] = useState<{ key: string; id: string; cwd: string } | null>(null)
  const key = workspaceId ?? projectId ?? ''

  useEffect(() => {
    if (!key) return
    let cancelled = false
    api('shell.open', workspaceId ? { workspaceId } : { projectId })
      .then((result) => !cancelled && setShell({ key, ...result }))
      .catch((error) => !cancelled && reportError(error, 'Open terminal'))
    return () => {
      cancelled = true
    }
  }, [key, workspaceId, projectId])

  if (!key) {
    return <EmptyState compact icon={<SquareTerminal />} title="No folder selected" description="Open a project or workspace to get a terminal there." />
  }
  const current = shell?.key === key ? shell : null
  return (
    <div className={styles.shell}>
      <div className={styles.shellBar}>
        {current && <PathTrail path={current.cwd} reveal={workspaceId ? { workspaceId } : { projectId }} />}
        <span className={styles.spacer} />
        {current && (
          <IconButton
            label="Restart terminal"
            icon={<RotateCcw />}
            onClick={() => void api('shell.restart', { id: current.id }).catch((e) => reportError(e, 'Restart terminal'))}
          />
        )}
      </div>
      <div className={styles.terminal}>{current && <TerminalView key={current.id} instanceId={current.id} />}</div>
    </div>
  )
}
