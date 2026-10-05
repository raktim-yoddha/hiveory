import { useLayoutEffect, useRef, type RefObject } from 'react'

const GLIDE = { duration: 420, easing: 'cubic-bezier(0.22, 1.2, 0.36, 1)' }

/**
 * FLIP: after each render, every `[data-flip="<key>"]` element inside `root`
 * that moved (even into another parent) glides from where it was — one
 * compositor-only transform animation per moved element, nothing per frame.
 */
export const useFlip = (root: RefObject<HTMLElement | null>): void => {
  const last = useRef(new Map<string, { x: number; y: number }>())
  useLayoutEffect(() => {
    const container = root.current
    if (!container) return
    const origin = container.getBoundingClientRect()
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    const next = new Map<string, { x: number; y: number }>()
    for (const node of container.querySelectorAll<HTMLElement>('[data-flip]')) {
      const rect = node.getBoundingClientRect()
      const position = { x: rect.left - origin.left, y: rect.top - origin.top }
      next.set(node.dataset.flip!, position)
      const previous = last.current.get(node.dataset.flip!)
      if (!previous || reduce) continue
      const dx = previous.x - position.x
      const dy = previous.y - position.y
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue
      node.animate([{ transform: `translate(${dx}px, ${dy}px)`, opacity: 1 }, { transform: 'none', opacity: 1 }], GLIDE)
    }
    last.current = next
  })
}
