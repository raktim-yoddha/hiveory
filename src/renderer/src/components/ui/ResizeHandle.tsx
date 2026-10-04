import { useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cx } from '../../lib/cx'
import styles from './ResizeHandle.module.css'

interface ResizeHandleProps {
  /** Accessible name, e.g. "Resize sidebar". */
  label: string
  value: number
  min: number
  max: number
  /** 1: dragging right grows the value (a left sidebar); -1: dragging left grows it (a right panel). */
  direction: 1 | -1
  onChange: (value: number) => void
  /** Double-click restores this width. */
  initial?: number
  className?: string
}

const KEY_STEP = 16

/**
 * Vertical drag handle for resizing a sidebar. Lives in the gutter, invisible
 * until hovered (like pane dividers); arrow keys resize it too.
 */
export function ResizeHandle({ label, value, min, max, direction, onChange, initial, className }: ResizeHandleProps) {
  const [active, setActive] = useState(false)

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const target = event.currentTarget
    const startX = event.clientX
    const start = value
    target.setPointerCapture(event.pointerId)
    setActive(true)
    const move = (e: globalThis.PointerEvent): void => onChange(start + (e.clientX - startX) * direction)
    const end = (): void => {
      setActive(false)
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', end)
      target.removeEventListener('pointercancel', end)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', end)
    target.addEventListener('pointercancel', end)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const delta = event.key === 'ArrowRight' ? KEY_STEP : event.key === 'ArrowLeft' ? -KEY_STEP : 0
    if (!delta) return
    event.preventDefault()
    onChange(value + delta * direction)
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={cx(styles.handle, active && styles.active, className)}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={initial !== undefined ? () => onChange(initial) : undefined}
    />
  )
}
