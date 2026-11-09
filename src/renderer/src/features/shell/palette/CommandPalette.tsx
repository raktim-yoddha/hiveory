import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ArrowRight, Columns2, Command, CornerDownLeft, FolderGit2, GitBranch, MessageSquare, PanelRight, Play, Search, Settings2, SquarePlus, Zap, type LucideIcon } from 'lucide-react'
import { cx } from '../../../lib/cx'
import { groupRanked, rankPalette, type PaletteItem } from './palette-rank'
import { usePalette } from './palette-store'
import { usePaletteItems } from './usePaletteItems'
import styles from './CommandPalette.module.css'

const MAX_SHOWN = 60

/** Each section's mark, so a long list reads at a glance; unknown groups get the arrow. */
const GROUP_ICON: Record<string, LucideIcon> = {
  'Open here': SquarePlus,
  'Run script': Play,
  'This worktree': Command,
  'Side panel': PanelRight,
  'Go to': FolderGit2,
  Commands: Zap,
  Lists: GitBranch,
  'Panes and tabs': Columns2,
  Chat: MessageSquare,
  Settings: Settings2
}

/**
 * The command palette (ADR 0060): Ctrl+Shift+P (⌘K) finds any command, Workspace, worktree, agent
 * to open or Settings page by typing; ↑ ↓ choose, Enter runs, Escape closes.
 */
export function CommandPalette() {
  const open = usePalette((s) => s.open)
  const close = usePalette((s) => s.close)
  const items = usePaletteItems(open)
  const ref = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState(0)
  // One section per group (titled once, not on every row); `shown` is their rows in order, for the keys.
  const sections = useMemo(() => groupRanked(rankPalette(items, query).slice(0, MAX_SHOWN)), [items, query])
  const shown = useMemo(() => sections.flatMap((s) => s.items), [sections])
  const active = Math.min(picked, Math.max(0, shown.length - 1))

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  useEffect(() => {
    ref.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const finish = (): void => {
    setQuery('')
    setPicked(0)
    close()
  }
  const runItem = (item: PaletteItem | undefined): void => {
    if (!item) return
    finish()
    // After the dialog is gone, so what it opens (Settings, a dialog) takes the focus.
    requestAnimationFrame(() => item.run())
  }

  const onKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const by = event.key === 'ArrowDown' ? 1 : -1
      setPicked((active + by + shown.length) % Math.max(1, shown.length))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runItem(shown[active])
    }
  }

  return (
    <dialog
      ref={ref}
      className={styles.dialog}
      aria-label="Command palette"
      onCancel={(event) => {
        event.preventDefault()
        finish()
      }}
      onMouseDown={(event) => {
        if (event.target === ref.current) finish()
      }}
    >
      {open && (
        <div className={styles.content}>
          <div className={styles.search}>
            <Search aria-hidden />
            <input
              autoFocus
              className={styles.input}
              placeholder="Find a command, worktree, agent or setting…"
              aria-label="Search commands"
              role="combobox"
              aria-expanded
              aria-controls="palette-list"
              aria-activedescendant={shown[active] ? `palette-${active}` : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setPicked(0)
              }}
              onKeyDown={onKey}
            />
          </div>
          <ul id="palette-list" role="listbox" aria-label="Results" className={styles.list}>
            {shown.length === 0 && <li className={styles.empty}>Nothing matches “{query}”.</li>}
            {sections.map((section, s) => {
              const Icon = GROUP_ICON[section.group] ?? ArrowRight
              return (
                <li key={section.group} role="group" aria-labelledby={`palette-group-${s}`} className={styles.section}>
                  <div id={`palette-group-${s}`} className={styles.sectionTitle}>
                    {section.group}
                  </div>
                  <ul role="none" className={styles.rows}>
                    {section.items.map((item) => {
                      const i = shown.indexOf(item)
                      const selected = i === active
                      return (
                        <li
                          key={item.id}
                          id={`palette-${i}`}
                          data-index={i}
                          role="option"
                          aria-selected={selected}
                          className={cx(styles.item, selected && styles.active)}
                          onMouseMove={() => !selected && setPicked(i)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => runItem(item)}
                        >
                          <Icon className={styles.icon} aria-hidden />
                          <span className={styles.text}>
                            <span className={styles.label}>{item.label}</span>
                            {item.hint && <span className={styles.hint}>{item.hint}</span>}
                          </span>
                          {item.keys && <kbd className={styles.keys}>{item.keys}</kbd>}
                          {selected && <CornerDownLeft className={styles.enter} aria-hidden />}
                        </li>
                      )
                    })}
                  </ul>
                </li>
              )
            })}
          </ul>
          <footer className={styles.footer} aria-hidden>
            <span>
              <kbd className={styles.keys}>↑</kbd> <kbd className={styles.keys}>↓</kbd> choose
            </span>
            <span>
              <kbd className={styles.keys}>Enter</kbd> open
            </span>
            <span>
              <kbd className={styles.keys}>Esc</kbd> close
            </span>
          </footer>
        </div>
      )}
    </dialog>
  )
}
