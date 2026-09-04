const MENU_WIDTH = 360
const MENU_GAP = 8
const VIEWPORT_MARGIN = 12
const MENU_MAX_HEIGHT = 560

export interface SplitMenuPosition {
  top: number
  left: number
  width: number
  maxHeight: number
  above: boolean
}

export function getSplitMenuPosition(
  anchorRect: Pick<DOMRect, 'top' | 'right' | 'bottom'>,
  viewport: Pick<Window, 'innerWidth' | 'innerHeight'>,
): SplitMenuPosition {
  const width = Math.min(MENU_WIDTH, Math.max(240, viewport.innerWidth - VIEWPORT_MARGIN * 2))
  const roomBelow = Math.max(0, viewport.innerHeight - anchorRect.bottom - VIEWPORT_MARGIN)
  const roomAbove = Math.max(0, anchorRect.top - VIEWPORT_MARGIN)
  const above = roomBelow < 360 && roomAbove > roomBelow
  const availableRoom = above ? roomAbove : roomBelow
  const maxHeight = Math.max(0, Math.min(MENU_MAX_HEIGHT, availableRoom, viewport.innerHeight - VIEWPORT_MARGIN * 2))
  const left = Math.max(
    VIEWPORT_MARGIN,
    Math.min(anchorRect.right - width, viewport.innerWidth - width - VIEWPORT_MARGIN),
  )

  return {
    top: above ? Math.max(VIEWPORT_MARGIN, anchorRect.top - MENU_GAP) : Math.min(viewport.innerHeight - VIEWPORT_MARGIN, anchorRect.bottom + MENU_GAP),
    left,
    width,
    maxHeight,
    above,
  }
}
