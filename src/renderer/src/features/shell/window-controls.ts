import { useEffect, type RefObject } from 'react'

/**
 * No title bar (ADR 0056): on Windows and Linux the native window controls sit over the window's
 * top-right corner. A top bar (`data-top-bar`: a pane's or the side panel's header) that reaches into
 * that corner gets `data-under-controls`, and its styles leave the controls room. Rechecked whenever
 * a bar resizes, panes move or the window resizes.
 */
export function useWindowControlsRoom(root: RefObject<HTMLElement | null>, platform: string): void {
  useEffect(() => {
    const el = root.current
    if (!el || platform === 'darwin') return
    let frame = 0
    const sizes = new ResizeObserver(() => check())
    const check = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const css = getComputedStyle(document.documentElement)
        const width = parseFloat(css.getPropertyValue('--window-controls-width'))
        const height = parseFloat(css.getPropertyValue('--window-controls-height'))
        for (const bar of el.querySelectorAll<HTMLElement>('[data-top-bar]')) {
          sizes.observe(bar)
          const r = bar.getBoundingClientRect()
          bar.toggleAttribute('data-under-controls', r.width > 0 && r.top < height && r.right > window.innerWidth - width)
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
  }, [root, platform])
}
