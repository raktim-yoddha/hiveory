import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { portalRoot } from '../../lib/portal-root'
import styles from './Popover.module.css'

export interface PopoverTriggerProps {
  ref: RefObject<HTMLButtonElement | null>
  onClick: () => void
  'aria-haspopup': 'dialog'
  'aria-expanded': boolean
}

interface PopoverProps {
  label: string
  trigger: (props: PopoverTriggerProps) => ReactNode
  children: (close: () => void) => ReactNode
  /** Opens above the trigger (e.g. a composer at the bottom of the screen). */
  placement?: 'above' | 'below'
  width?: 'md' | 'lg'
  /** 'end' lines the panel's right edge up with the trigger's (triggers near the right of the screen). */
  align?: 'start' | 'end'
}

const GAP = 6

/** Anchored floating panel for rich pickers (search + lists). Escape / outside click closes; focus returns. */
export function Popover({ label, trigger, children, placement = 'below', width = 'md', align = 'start' }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [root, setRoot] = useState<Element | null>(null)

  const close = useCallback(() => {
    setOpen(false)
    setPosition(null)
  }, [])

  // Return focus to the trigger whenever the panel closes.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (wasOpen.current && !open) triggerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !panelRef.current) return
    const t = triggerRef.current.getBoundingClientRect()
    const p = panelRef.current.getBoundingClientRect()
    let top = placement === 'above' ? t.top - p.height - GAP : t.bottom + GAP
    if (top < GAP) top = t.bottom + GAP
    if (top + p.height > window.innerHeight - GAP) top = Math.max(GAP, t.top - p.height - GAP)
    const left = Math.min(Math.max(GAP, align === 'end' ? t.right - p.width : t.left), window.innerWidth - p.width - GAP)
    setPosition({ top, left })
  }, [open, placement, align])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      const target = e.target as Node
      if (!panelRef.current?.contains(target) && !triggerRef.current?.contains(target)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        close()
      }
    }
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, close])

  return (
    <>
      {trigger({ ref: triggerRef, onClick: () => {
          if (open) return close()
          setRoot(portalRoot(triggerRef.current))
          setOpen(true)
        }, 'aria-haspopup': 'dialog', 'aria-expanded': open })}
      {open &&
        root &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            className={styles.panel}
            data-width={width}
            style={position ? { top: position.top, left: position.left } : { visibility: 'hidden', top: 0, left: 0 }}
          >
            {children(close)}
          </div>,
          root
        )}
    </>
  )
}
