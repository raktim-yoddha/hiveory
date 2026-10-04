import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../../lib/cx'
import styles from './Menu.module.css'

export type MenuEntry =
  | { type: 'label'; label: string }
  | { type: 'separator' }
  | {
      type: 'item'
      id: string
      label: string
      icon?: ReactNode
      hint?: string
      disabled?: boolean
      danger?: boolean
      /** Renders as a radio item (e.g. a placement choice). */
      checked?: boolean
      /** Keep the menu open after selecting, for in-menu choices. */
      keepOpen?: boolean
      onSelect: () => void
    }

export interface MenuTriggerProps {
  ref: RefObject<HTMLButtonElement | null>
  onClick: () => void
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
}

interface MenuProps {
  /** Accessible name of the menu. */
  label: string
  items: MenuEntry[]
  trigger: (props: MenuTriggerProps) => ReactNode
  align?: 'start' | 'end'
  /** Rendered when there are no items. */
  empty?: ReactNode
}

const GAP = 4

/** Accessible popover menu: arrow-key navigation, Escape/outside-click to close, focus restore. */
export function Menu({ label, items, trigger, align = 'start', empty }: MenuProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    setPosition(null)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !menuRef.current) return
    const t = triggerRef.current.getBoundingClientRect()
    const m = menuRef.current.getBoundingClientRect()
    let left = align === 'end' ? t.right - m.width : t.left
    let top = t.bottom + GAP
    if (top + m.height > window.innerHeight - GAP) top = Math.max(GAP, t.top - m.height - GAP)
    left = Math.min(Math.max(GAP, left), window.innerWidth - m.width - GAP)
    setPosition({ top, left })
  }, [open, align])

  useEffect(() => {
    if (!open || !position) return
    menuRef.current?.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus()
  }, [open, position])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!menuRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false)
    }
    const onBlur = (): void => close(false)
    document.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  }, [open, close])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const enabled = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? [])]
    const index = enabled.indexOf(document.activeElement as HTMLButtonElement)
    const focusAt = (i: number): void => enabled[(i + enabled.length) % enabled.length]?.focus()
    if (event.key === 'ArrowDown') focusAt(index + 1)
    else if (event.key === 'ArrowUp') focusAt(index - 1)
    else if (event.key === 'Home') focusAt(0)
    else if (event.key === 'End') focusAt(enabled.length - 1)
    else if (event.key === 'Escape') close()
    else if (event.key === 'Tab') close(false)
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <>
      {trigger({
        ref: triggerRef,
        onClick: () => (open ? close() : setOpen(true)),
        'aria-haspopup': 'menu',
        'aria-expanded': open
      })}
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={label}
            className={styles.menu}
            style={position ? { top: position.top, left: position.left } : { visibility: 'hidden', top: 0, left: 0 }}
            onKeyDown={onKeyDown}
          >
            {items.length === 0 && <div className={styles.empty}>{empty ?? 'Nothing here'}</div>}
            {items.map((entry, i) => {
              if (entry.type === 'separator') return <div key={`sep-${i}`} role="separator" className={styles.separator} />
              if (entry.type === 'label')
                return (
                  <div key={`label-${i}`} className={styles.label} role="presentation">
                    {entry.label}
                  </div>
                )
              return (
                <button
                  key={entry.id}
                  type="button"
                  role={entry.checked === undefined ? 'menuitem' : 'menuitemradio'}
                  aria-checked={entry.checked}
                  disabled={entry.disabled}
                  className={cx(styles.item, entry.danger && styles.danger, entry.checked && styles.checked)}
                  onClick={() => {
                    if (!entry.keepOpen) close()
                    entry.onSelect()
                  }}
                >
                  <span className={styles.icon}>{entry.icon}</span>
                  <span className={styles.text}>{entry.label}</span>
                  {entry.hint && <span className={styles.hint}>{entry.hint}</span>}
                </button>
              )
            })}
          </div>,
          document.body
        )}
    </>
  )
}
