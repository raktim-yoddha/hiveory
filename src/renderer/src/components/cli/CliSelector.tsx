import { useEffect } from 'react'
import { RefreshCw } from 'lucide-react'
import type { CliSelection } from '@shared/domain'
import { MAX_INSTANCES_PER_CLI } from '@shared/ipc/contract'
import { useHostClis } from '../../stores/data'
import { selectedProjectId, useNavigation } from '../../stores/navigation'
import { Button, IconButton } from '../ui/Button'
import { CounterControl } from '../ui/CounterControl'
import { CliLogo } from './CliLogo'
import styles from './CliSelector.module.css'

interface CliSelectorProps {
  value: CliSelection[]
  onChange: (value: CliSelection[]) => void
}

/**
 * Per-CLI instance counts over the dynamically discovered CLI list. Shared by
 * Workspace creation and the preset editor (STARTER_PROMPT §10).
 */
export function CliSelector({ value, onChange }: CliSelectorProps) {
  const projectId = useNavigation((s) => selectedProjectId(s.view))
  const { clis, loaded, load } = useHostClis(projectId)
  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  // Agents only: shells open from a pane's "+" menu.
  const agents = clis.filter((c) => c.kind !== 'shell')
  const available = agents.filter((c) => c.available)
  const missing = agents.filter((c) => !c.available)
  const countOf = (cliId: string): number => value.find((s) => s.cliId === cliId)?.count ?? 0

  const setCount = (cliId: string, count: number): void => {
    const others = value.filter((s) => s.cliId !== cliId)
    // Keep discovery order so configurations read the same everywhere.
    const next = [...others, ...(count > 0 ? [{ cliId, count }] : [])]
    onChange(clis.flatMap((c) => next.filter((s) => s.cliId === c.id)))
  }

  const addAll = (): void => onChange(available.map((c) => ({ cliId: c.id, count: Math.max(1, countOf(c.id)) })))

  return (
    <div className={styles.root}>
      <ul className={styles.list} aria-label="Agents">
        {available.map((cli) => {
          const count = countOf(cli.id)
          return (
            <li key={cli.id} className={styles.row} data-selected={count > 0}>
              <label className={styles.check}>
                <input
                  type="checkbox"
                  checked={count > 0}
                  onChange={(e) => setCount(cli.id, e.target.checked ? 1 : 0)}
                />
                <CliLogo cliId={cli.id} />
                <span className={styles.name}>{cli.displayName}</span>
              </label>
              <CounterControl
                label={`${cli.displayName} instances`}
                value={count}
                max={MAX_INSTANCES_PER_CLI}
                onChange={(n) => setCount(cli.id, n)}
              />
            </li>
          )
        })}
        {loaded && available.length === 0 && (
          <li className={styles.none}>No supported CLIs were found on this machine.</li>
        )}
      </ul>
      <div className={styles.footer}>
        <Button size="sm" onClick={addAll} disabled={available.length === 0}>
          Add all CLIs
        </Button>
        {missing.length > 0 && (
          <span className={styles.missing} title={missing.map((c) => c.displayName).join(', ')}>
            {missing.length} supported {missing.length === 1 ? 'CLI' : 'CLIs'} not detected
          </span>
        )}
        <IconButton label="Detect CLIs again" icon={<RefreshCw />} onClick={() => void load(true)} />
      </div>
    </div>
  )
}
