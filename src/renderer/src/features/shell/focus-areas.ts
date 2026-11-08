/**
 * Moving the keyboard between the window's areas (ADR 0061), as native apps do with F6: the sidebar,
 * the open worktree (or Home) and the side panel. Each area gets back the control that last had focus
 * in it; hidden areas are skipped and the order wraps around.
 */
const AREAS = ['nav[aria-label="Workspaces"]', 'main', 'aside[aria-label="Side panel"]']
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const lastFocused = new WeakMap<Element, HTMLElement>()
let tracking = false

const shown = (el: Element): boolean => el instanceof HTMLElement && el.getClientRects().length > 0 && !el.closest('[inert],[aria-hidden="true"]')

/** Remembers, per area, the last control that had focus (installed once). */
export const trackAreaFocus = (): (() => void) => {
  if (tracking) return () => undefined
  tracking = true
  const onFocus = (event: FocusEvent): void => {
    const target = event.target
    if (!(target instanceof HTMLElement)) return
    for (const selector of AREAS) {
      const area = target.closest(selector)
      if (area) lastFocused.set(area, target)
    }
  }
  document.addEventListener('focusin', onFocus)
  return () => {
    tracking = false
    document.removeEventListener('focusin', onFocus)
  }
}

/** Focuses the next (1) or previous (-1) area; false when there is nowhere to go. */
export function focusArea(by: 1 | -1): boolean {
  const areas = AREAS.map((s) => document.querySelector(s)).filter((el): el is HTMLElement => el !== null && shown(el))
  if (!areas.length) return false
  const current = areas.findIndex((a) => a.contains(document.activeElement))
  const next = areas[(current + by + areas.length) % areas.length]!
  const remembered = lastFocused.get(next)
  const target = remembered && remembered.isConnected && next.contains(remembered) && shown(remembered) ? remembered : [...next.querySelectorAll<HTMLElement>(FOCUSABLE)].find(shown)
  if (!target) return false
  target.focus()
  return document.activeElement === target
}
