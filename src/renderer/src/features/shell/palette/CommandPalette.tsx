import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Search } from 'lucide-react'
import { cx } from '../../../lib/cx'
import { rankPalette, type PaletteItem } from './palette-rank'
import { usePalette } from './palette-store'
import { usePaletteItems } from './usePaletteItems'
import styles from './CommandPalette.module.css'

const MAX_SHOWN = 60

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
  const shown = useMemo(() => rankPalette(items, query).slice(0, MAX_SHOWN), [items, query])
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
            {shown.map((item, i) => (
              <li
                key={item.id}
                id={`palette-${i}`}
                data-index={i}
                role="option"
                aria-selected={i === active}
                className={cx(styles.item, i === active && styles.active)}
                onMouseMove={() => i !== active && setPicked(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => runItem(item)}
              >
                <span className={styles.group}>{item.group}</span>
                <span className={styles.label}>{item.label}</span>
                {item.hint && <span className={styles.hint}>{item.hint}</span>}
                <span className={styles.flex} />
                {item.keys && <kbd className={styles.keys}>{item.keys}</kbd>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </dialog>
  )
}
