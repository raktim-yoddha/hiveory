import { useLayoutEffect, useState, type CSSProperties, type DependencyList, type RefObject } from 'react'

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Where the selected item sits inside a container (offset box), kept up to
 * date on resize. A single indicator element then glides there with a CSS
 * transform — the "liquid" selection used by tabs and the settings nav.
 * Returns CSS variables --x, --y, --w, --h, or null when nothing is selected.
 */
export const useSelectionBox = (container: RefObject<HTMLElement | null>, selector: string, deps: DependencyList): CSSProperties | null => {
  const [box, setBox] = useState<Box | null>(null)
  useLayoutEffect(() => {
    const root = container.current
    if (!root) return
    const measure = (): void => {
      const el = root.querySelector<HTMLElement>(selector)
      setBox((prev) => {
        if (!el) return null
        const next = { x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight }
        return prev && prev.x === next.x && prev.y === next.y && prev.width === next.width && prev.height === next.height ? prev : next
      })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return box ? ({ '--x': `${box.x}px`, '--y': `${box.y}px`, '--w': `${box.width}px`, '--h': `${box.height}px` } as CSSProperties) : null
}
