import { useEffect, type RefObject } from 'react'

/**
 * No title bar (ADR 0056): the side panel's button and, on Windows and Linux, the native window
 * controls sit over the window's top-right corner. A top bar (`data-top-bar`: a pane's or the side
 * panel's header) that reaches into that corner gets `data-under-controls`, and its styles leave them
 * room (`--top-right-room`). Rechecked whenever
 * a bar resizes, panes move or the window resizes.
 */
export function useWindowControlsRoom(root: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const el = root.current
    if (!el) return
    let frame = 0
    const sizes = new ResizeObserver(() => check())
    const check = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // The corner: a bar at the top whose right edge meets the main area's (its padding is plain px).
        const css = getComputedStyle(el)
        const edge = el.getBoundingClientRect().right - parseFloat(css.paddingRight) - 1
        const height = parseFloat(css.getPropertyValue('--window-controls-height'))
        for (const bar of el.querySelectorAll<HTMLElement>('[data-top-bar]')) {
          sizes.observe(bar)
          const r = bar.getBoundingClientRect()
          bar.toggleAttribute('data-under-controls', r.width > 0 && r.top < height && r.right >= edge)
        }
      })
    }
    const moves = new MutationObserver(check)
    moves.observe(el, { subtree: true, childList: true })
    sizes.observe(el)
    window.addEventListener('resize', check)
    check()
    return () => {
      cancelAnimationFrame(frame)
      sizes.disconnect()
      moves.disconnect()
      window.removeEventListener('resize', check)
    }
  }, [root])
}
