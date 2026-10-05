import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { cx } from '../../lib/cx'
import { portalRoot } from '../../lib/portal-root'
import styles from './form.module.css'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  /** Consecutive options sharing a group are listed under its heading; an empty group is a plain divider. */
  group?: string
}

interface SelectProps {
  label: string
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  /** Hide the visible label (still announced to assistive tech). */
  hideLabel?: boolean
  /** 'sm' for toolbars: a compact borderless trigger. */
  size?: 'md' | 'sm'
}

const GAP = 4
const TYPEAHEAD_MS = 600

/**
 * The app's only dropdown. A themed listbox replaces the native <select>, whose
 * popup is drawn by the OS and ignores the design tokens. Keyboard behaviour
 * follows the native control: arrows, Home/End, Enter/Space, Escape, type-ahead.
 */
export function Select({ label, value, options, onChange, hideLabel, size = 'md' }: SelectProps) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [position, setPosition] = useState<{ top: number; left: number; minWidth: number } | null>(null)
  const [root, setRoot] = useState<Element | null>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })

  const selectedIndex = options.findIndex((o) => o.value === value)
  const selected = options[selectedIndex]
  const enabled = (i: number): boolean => options[i] !== undefined && !options[i].disabled

  const show = (start = selectedIndex): void => {
    setRoot(portalRoot(triggerRef.current))
    setActive(enabled(start) ? start : options.findIndex((o) => !o.disabled))
    setOpen(true)
  }
  const close = (restoreFocus = true): void => {
    setOpen(false)
    setPosition(null)
    if (restoreFocus) triggerRef.current?.focus()
  }
  const choose = (i: number): void => {
    const option = options[i]
    if (!option || option.disabled) return
    close()
    if (option.value !== value) onChange(option.value)
  }
  /** Next enabled option from `from` in `step` direction; stays put at the ends. */
  const step = (from: number, dir: 1 | -1): number => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (enabled(i)) return i
    return from
  }
  /** `at` is the key event's timestamp: letters typed within TYPEAHEAD_MS of each other form one search. */
  const typeahead = (key: string, from: number, at: number): number => {
    typed.current = { text: at - typed.current.at < TYPEAHEAD_MS ? typed.current.text + key : key, at }
    const text = typed.current.text.toLowerCase()
    const order = [...options.keys()].map((k) => (from + 1 + k) % options.length)
    // A repeated single letter cycles through matches, like the native control.
    const match = order.find((i) => enabled(i) && options[i]?.label.toLowerCase().startsWith(text))
    return match ?? from
  }

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !listRef.current) return
    const t = triggerRef.current.getBoundingClientRect()
    const l = listRef.current.getBoundingClientRect()
    let top = t.bottom + GAP
    if (top + l.height > window.innerHeight - GAP) top = Math.max(GAP, t.top - l.height - GAP)
    const left = Math.min(Math.max(GAP, t.left), window.innerWidth - Math.max(l.width, t.width) - GAP)
    setPosition({ top, left, minWidth: t.width })
  }, [open])

  useEffect(() => {
    if (!open || !position) return
    listRef.current?.focus()
  }, [open, position])

  useEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active, position])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node
      if (!listRef.current?.contains(target) && !triggerRef.current?.contains(target)) close(false)
    }
    const onBlur = (): void => close(false)
    document.addEventListener('pointerdown', onDown, true)
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  })

  const onTriggerKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') show()
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Closed type-ahead changes the value directly, as a native select does.
      const option = options[typeahead(e.key, selectedIndex, e.timeStamp)]
      if (option && option.value !== value) onChange(option.value)
    } else return
    e.preventDefault()
  }

  const onListKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowDown') setActive((i) => step(i, 1))
    else if (e.key === 'ArrowUp') setActive((i) => step(i, -1))
    else if (e.key === 'Home') setActive(step(-1, 1))
    else if (e.key === 'End') setActive(step(options.length, -1))
    else if (e.key === 'Enter' || e.key === ' ') choose(active)
    else if (e.key === 'Escape') close()
    else if (e.key === 'Tab') close(false)
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) setActive(typeahead(e.key, active, e.timeStamp))
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const list = options.map((option, i) => {
    // A heading (or divider) appears where a new group starts.
    const heading = option.group !== undefined && option.group !== options[i - 1]?.group ? option.group : null
    return (
      <div key={`${i}:${option.value}`} role="presentation">
        {heading !== null &&
          (heading ? (
            <div className={styles.listboxGroup} role="presentation">
              {heading}
            </div>
          ) : (
            <div className={styles.listboxSeparator} role="separator" />
          ))}
        <div
          id={`${id}-o${i}`}
          data-index={i}
          role="option"
          aria-selected={i === selectedIndex}
          aria-disabled={option.disabled || undefined}
          className={cx(styles.option, i === active && styles.optionActive)}
          onPointerMove={() => enabled(i) && i !== active && setActive(i)}
          onClick={() => choose(i)}
        >
          <span className={styles.optionLabel}>{option.label}</span>
          {i === selectedIndex && <Check className={styles.optionCheck} aria-hidden />}
        </div>
      </div>
    )
  })

  return (
    <div className={size === 'sm' ? styles.selectInline : styles.field}>
      <span id={`${id}-label`} className={hideLabel || size === 'sm' ? 'sr-only' : styles.fieldLabel}>
        {label}
      </span>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${id}-list` : undefined}
        aria-labelledby={`${id}-label`}
        className={cx(styles.select, size === 'sm' && styles.selectSm)}
        onClick={() => (open ? close() : show())}
        onKeyDown={onTriggerKey}
      >
        <span className={styles.selectValue}>{selected?.label ?? ''}</span>
        <ChevronDown className={styles.selectIcon} aria-hidden />
      </button>
      {open &&
        root &&
        createPortal(
          <div
            ref={listRef}
            id={`${id}-list`}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={`${id}-label`}
            aria-activedescendant={active >= 0 ? `${id}-o${active}` : undefined}
            className={cx(styles.listbox, size === 'sm' && styles.listboxSm)}
            style={position ? position : { visibility: 'hidden', top: 0, left: 0 }}
            onKeyDown={onListKey}
          >
            {list}
          </div>,
          root
        )}
    </div>
  )
}
