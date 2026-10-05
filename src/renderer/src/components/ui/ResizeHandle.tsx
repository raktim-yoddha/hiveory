import { useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { cx } from '../../lib/cx'
import styles from './ResizeHandle.module.css'

interface ResizeHandleProps {
  /** Accessible name, e.g. "Resize sidebar". */
  label: string
  value: number
  min: number
  max: number
  /** 1: dragging right (down) grows the value (a left sidebar); -1: dragging left (up) grows it (a right panel). */
  direction: 1 | -1
  /** `horizontal`: a divider between a top and a bottom area, dragged up and down. Default: vertical. */
  orientation?: 'vertical' | 'horizontal'
  onChange: (value: number) => void
  /** Double-click restores this width. */
  initial?: number
  /** Dragging (or arrowing) well past `min` hides the sidebar instead of stopping at it, like VS Code. */
  onCollapse?: () => void
  className?: string
  style?: CSSProperties
}

const KEY_STEP = 16
/** Fraction of the minimum width below which a drag collapses the sidebar. */
const COLLAPSE_AT = 0.6

/**
 * Vertical drag handle for resizing a sidebar. Lives in the gutter, invisible
 * until hovered (like pane dividers); arrow keys resize it too.
 */
export function ResizeHandle({ label, value, min, max, direction, orientation = 'vertical', onChange, initial, onCollapse, className, style }: ResizeHandleProps) {
  const [active, setActive] = useState(false)
  const across = orientation === 'horizontal'

  const onPointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    const target = event.currentTarget
    const startX = across ? event.clientY : event.clientX
    const start = value
    target.setPointerCapture(event.pointerId)
    setActive(true)
    const move = (e: globalThis.PointerEvent): void => {
      const next = start + ((across ? e.clientY : e.clientX) - startX) * direction
      if (onCollapse && next < min * COLLAPSE_AT) {
        end()
        // Keep the width from before the drag, so showing the sidebar again restores it.
        onChange(start)
        onCollapse()
      } else onChange(next)
    }
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
    const delta = event.key === (across ? 'ArrowDown' : 'ArrowRight') ? KEY_STEP : event.key === (across ? 'ArrowUp' : 'ArrowLeft') ? -KEY_STEP : 0
    if (!delta) return
    event.preventDefault()
    const next = value + delta * direction
    if (onCollapse && next < min) onCollapse()
    else onChange(next)
  }

  return (
    <div
      role="separator"
      aria-orientation={across ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      style={style}
      className={cx(styles.handle, across && styles.horizontal, active && styles.active, className)}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      onDoubleClick={initial !== undefined ? () => onChange(initial) : undefined}
    />
  )
}
