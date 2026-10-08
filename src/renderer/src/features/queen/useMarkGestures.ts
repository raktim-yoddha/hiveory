import { useRef, type PointerEvent as ReactPointerEvent } from 'react'
import { useQueen, type QueenSpot } from './useQueen'

/** Movement before a press on her mark counts as a drag, so a tap or double-tap never moves the bar. */
const DRAG_THRESHOLD_PX = 4

/** The spot a drag ends in: the third of the window the pointer was let go in. */
export const spotAt = (x: number, width: number): QueenSpot => (x < width / 3 ? 'left' : x > (width * 2) / 3 ? 'right' : 'middle')

/**
 * Hold her mark and drag to move the floating bar; it follows the pointer and snaps to the
 * left, middle or right of the window on release. The frame is moved through a CSS variable
 * on the `[data-queen-floating]` element, so dragging never re-renders.
 */
export function useMarkGestures(enabled: boolean) {
  const dragged = useRef(false)

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!enabled || event.button !== 0) return
    const mark = event.currentTarget
    const frame = mark.closest<HTMLElement>('[data-queen-floating]')
    if (!frame) return
    const startX = event.clientX
    dragged.current = false
    mark.setPointerCapture(event.pointerId)
    const move = (e: PointerEvent): void => {
      const dx = e.clientX - startX
      if (!dragged.current && Math.abs(dx) < DRAG_THRESHOLD_PX) return
      dragged.current = true
      frame.dataset.dragging = ''
      frame.style.setProperty('--drag-x', `${dx}px`)
    }
    const end = (e: PointerEvent): void => {
      mark.removeEventListener('pointermove', move)
      mark.removeEventListener('pointerup', end)
      mark.removeEventListener('pointercancel', end)
      delete frame.dataset.dragging
      frame.style.removeProperty('--drag-x')
      if (dragged.current && e.type === 'pointerup') useQueen.getState().setSpot(spotAt(e.clientX, window.innerWidth))
    }
    mark.addEventListener('pointermove', move)
    mark.addEventListener('pointerup', end)
    mark.addEventListener('pointercancel', end)
  }

  /** A drag ends in a click on the mark; that click is not a tap. Call once per click. */
  const wasDrag = (): boolean => {
    const was = dragged.current
    dragged.current = false
    return was
  }

  return { onPointerDown, wasDrag }
}
