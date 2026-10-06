import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowDown, ArrowRight, Plus, Search } from 'lucide-react'
import type { CliDescriptor } from '@shared/domain'
import { CliLogo } from '../../components/cli/CliLogo'
import { IconButton } from '../../components/ui/Button'
import { Popover } from '../../components/ui/Popover'
import { cx } from '../../lib/cx'
import { useHostClis } from '../../stores/data'
import { selectedProjectId, useNavigation } from '../../stores/navigation'
import { agentActions } from './agent-actions'
import styles from './AddAgentMenu.module.css'

interface AddAgentMenuProps {
  workspaceId: string
  /** The pane the new pane is placed beside. */
  paneId: string
  /** Whether a split in each direction still leaves both panes above their minimum size. */
  fits: { right: boolean; bottom: boolean }
}

/**
 * The pane header "+": where (Right | Bottom, side by side), then what — a
 * terminal (PowerShell, Command Prompt, Git Bash) or a detected agent CLI —
 * with search. Nothing is hardcoded: entries come from the CLI registry.
 */
export function AddAgentMenu({ workspaceId, paneId, fits }: AddAgentMenuProps) {
  return (
    <Popover label="Add pane" align="end" trigger={(props) => <IconButton {...props} label="Add agent" icon={<Plus />} />}>
      {(close) => <AddPanePicker workspaceId={workspaceId} paneId={paneId} fits={fits} onDone={close} />}
    </Popover>
  )
}

function AddPanePicker({ workspaceId, paneId, fits, onDone }: AddAgentMenuProps & { onDone: () => void }) {
  const projectId = useNavigation((s) => selectedProjectId(s.view))
  const { clis, loaded, load } = useHostClis(projectId)
  const [preferred, setSide] = useState<'right' | 'bottom'>('right')
  const [query, setQuery] = useState('')
  const listRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const searchId = useId()
  // Fall back to whichever direction fits; if neither does, the pane docks along the layout edge.
  const side = fits[preferred] ? preferred : fits.right ? 'right' : fits.bottom ? 'bottom' : null

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const shown = clis.filter((c) => c.available && (!q || c.displayName.toLowerCase().includes(q)))
    return [
      { label: 'Terminals', items: shown.filter((c) => c.kind === 'shell') },
      { label: 'Agents', items: shown.filter((c) => c.kind !== 'shell') }
    ].filter((g) => g.items.length)
  }, [clis, query])

  const open = (cli: CliDescriptor): void => {
    onDone()
    void agentActions.open(workspaceId, cli.id, side ? { targetPaneId: paneId, side } : undefined)
  }

  const items = (): HTMLButtonElement[] => [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])]
  const onListKey = (event: KeyboardEvent): void => {
    const all = items()
    const index = all.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'ArrowDown') all[Math.min(index + 1, all.length - 1)]?.focus()
    else if (event.key === 'ArrowUp') (index <= 0 ? searchRef.current : all[index - 1])?.focus()
    else return
    event.preventDefault()
  }

  const placement = (value: 'right' | 'bottom', label: string, icon: ReactNode, hint: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={side === value}
      disabled={!fits[value]}
      title={fits[value] ? undefined : hint}
      className={cx(styles.side, side === value && styles.sideOn)}
      onClick={() => setSide(value)}
    >
      {icon}
      {label}
    </button>
  )

  return (
    <div className={styles.picker}>
      <div className={styles.sides} role="radiogroup" aria-label="Placement">
        {placement('right', 'Right', <ArrowRight aria-hidden />, 'Too narrow')}
        {placement('bottom', 'Bottom', <ArrowDown aria-hidden />, 'Too short')}
      </div>
      <label className={styles.search} htmlFor={searchId}>
        <Search aria-hidden />
        <input
          ref={searchRef}
          id={searchId}
          autoFocus
          value={query}
          placeholder="Search terminals and agents"
          aria-label="Search terminals and agents"
          spellCheck={false}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              items()[0]?.focus()
            } else if (e.key === 'Enter') {
              // Otherwise the same Enter lands on the "+" button once focus returns to it and reopens the picker.
              e.preventDefault()
              const first = groups[0]?.items[0]
              if (first) open(first)
            }
          }}
        />
      </label>
      <div ref={listRef} className={styles.list} role="menu" aria-label="Open" onKeyDown={onListKey}>
        {groups.length === 0 && <p className={styles.empty}>{query ? 'No matches' : 'No CLIs detected'}</p>}
        {groups.map((group) => (
          <div key={group.label} className={styles.group}>
            <div className={styles.groupLabel}>{group.label}</div>
            {group.items.map((cli) => (
              <button key={cli.id} type="button" role="menuitem" className={styles.item} onClick={() => open(cli)}>
                <CliLogo cliId={cli.id} size="sm" />
                <span>{cli.displayName}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
