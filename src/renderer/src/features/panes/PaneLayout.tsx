import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { LayoutNode, LayoutOperation } from '@shared/domain'
import { computeGeometry, dragDivider, fitToMinimums, minSizeOf, neighborOf, relativeGeometry, type Divider, type MinPaneSize, type Rect, type RelativeRect, type Span } from '@shared/layout/geometry'
import { resizeSplit } from '@shared/layout/operations'
import { cx } from '../../lib/cx'
import { PaneDropPreview } from './PaneDropPreview'
import { usePaneDrag } from './usePaneDrag'
import styles from './PaneLayout.module.css'

export interface PaneRenderProps {
  /** Spread onto the element that starts a drag (the pane header). */
  onDragHandlePointerDown: (event: ReactPointerEvent) => void
  dragging: boolean
  /** The pane fills the whole layout area; the others stay mounted but hidden. */
  maximized: boolean
  toggleMaximize: () => void
  /** The pane's current rect within the layout (for placement decisions). */
  rect: Rect
  /** Smallest size a pane may take; used to decide whether a split still fits. */
  minSize: { width: number; height: number }
  gutter: number
  /** Swaps this pane with its nearest neighbour in a direction (keyboard-accessible rearranging). */
  moveTo: ((direction: 'left' | 'right' | 'up' | 'down') => void) | null
}

interface PaneLayoutProps {
  tree: LayoutNode | null
  renderPane: (paneId: string, props: PaneRenderProps) => ReactNode
  onOperation: (operation: LayoutOperation) => void
  /** A pane that needs to stay wider than the shared minimum (px); dividers stop there. */
  paneMinWidth?: (paneId: string) => number | undefined
  /** The smallest size the whole layout can take (every pane at its minimum, plus gutters). */
  onMinSizeChange?: (size: MinPaneSize) => void
}

const readPx = (el: HTMLElement, token: string, fallback: number): number => {
  const value = parseFloat(getComputedStyle(el).getPropertyValue(token))
  return Number.isFinite(value) ? value : fallback
}

const calc = (s: Span): string => (s.px ? `calc(${s.share * 100}% + ${s.px}px)` : `${s.share * 100}%`)
/**
 * Where a pane or divider sits, as shares of the layout plus px: the browser places it in the
 * same frame the layout resizes (a sidebar moving), so nothing trails a frame behind. Only layout
 * changes (split, swap, close) change these values, so only they animate.
 */
const placed = (r: RelativeRect): CSSProperties => ({ left: calc(r.x), top: calc(r.y), width: calc(r.width), height: calc(r.height) })
const FULL: CSSProperties = { left: 0, top: 0, width: '100%', height: '100%' }

const dividerKey = (d: Divider): string => `${d.path.join('.')}:${d.index}`

/**
 * Reusable recursive pane layout. Knows nothing about what panes contain
 * (architecture.md "Pane Layout"). Panes are absolutely positioned from the
 * tree so a pane's DOM node — and its terminal — survives rearrangement.
 */
export function PaneLayout({ tree, renderPane, onOperation, paneMinWidth, onMinSizeChange }: PaneLayoutProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [bounds, setBounds] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 })
  const [metrics, setMetrics] = useState({ gutter: 10, minWidth: 240, minHeight: 140 })
  /** Local ratios while a divider is being dragged; committed on release. */
  const [resizing, setResizing] = useState<{ key: string; tree: LayoutNode | null } | null>(null)
  const [maximizedId, setMaximizedId] = useState<string | null>(null)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    setMetrics({
      gutter: readPx(el, '--gutter', 10),
      minWidth: readPx(el, '--pane-min-width', 240),
      minHeight: readPx(el, '--pane-min-height', 140)
    })
    // Pixel bounds are for drag targets and limits only; pane positions are relative (see placed()).
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBounds({ x: 0, y: 0, width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const activeTree = resizing?.tree ?? tree
  const minSize = useMemo(() => ({ width: metrics.minWidth, height: metrics.minHeight }), [metrics.minWidth, metrics.minHeight])
  const minFor = useMemo(
    () => (paneId: string) => ({ width: Math.max(minSize.width, paneMinWidth?.(paneId) ?? 0), height: minSize.height }),
    [minSize, paneMinWidth]
  )
  // What is shown: the ratios fitted so no pane is below its minimum while the space allows.
  const shownTree = useMemo(() => fitToMinimums(activeTree, bounds, metrics.gutter, minFor), [activeTree, bounds, metrics.gutter, minFor])
  const geometry = useMemo(() => computeGeometry(shownTree, bounds, metrics.gutter, minFor), [shownTree, bounds, metrics.gutter, minFor])
  const relative = useMemo(() => relativeGeometry(shownTree, metrics.gutter), [shownTree, metrics.gutter])
  const minWidth = tree ? minSizeOf(tree, minFor, metrics.gutter).width : 0
  const minHeight = tree ? minSizeOf(tree, minFor, metrics.gutter).height : 0
  useEffect(() => {
    onMinSizeChange?.({ width: minWidth, height: minHeight })
    return () => onMinSizeChange?.({ width: 0, height: 0 })
  }, [minWidth, minHeight, onMinSizeChange])
  const { drag, startDrag } = usePaneDrag({ containerRef, panes: geometry.panes, onOperation })
  // Falls back to the normal layout if the maximized pane was closed.
  const maximized = maximizedId && geometry.panes[maximizedId] ? maximizedId : null

  const startResize = (d: Divider, event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const target = event.currentTarget
    target.setPointerCapture(event.pointerId)
    const origin = d.direction === 'horizontal' ? event.clientX : event.clientY
    const key = dividerKey(d)
    let latest: LayoutNode | null = tree
    const onMove = (e: PointerEvent): void => {
      const delta = (d.direction === 'horizontal' ? e.clientX : e.clientY) - origin
      latest = resizeSplit(tree, d.path, dragDivider(d, delta, metrics.gutter))
      setResizing({ key, tree: latest })
    }
    const onUp = (): void => {
      target.removeEventListener('pointermove', onMove)
      target.removeEventListener('pointerup', onUp)
      target.removeEventListener('pointercancel', onUp)
      const node = latest
      if (node && node !== tree) {
        const split = d.path.reduce<LayoutNode | null>((n, i) => (n?.type === 'split' ? (n.children[i] ?? null) : null), node)
        if (split?.type === 'split') onOperation({ type: 'resize', path: d.path, ratios: split.ratios })
      }
      setResizing(null)
    }
    target.addEventListener('pointermove', onMove)
    target.addEventListener('pointerup', onUp)
    target.addEventListener('pointercancel', onUp)
  }

  const nudge = (d: Divider, direction: number): void => {
    const step = (d.direction === 'horizontal' ? d.splitRect.width : d.splitRect.height) * 0.02
    onOperation({ type: 'resize', path: d.path, ratios: dragDivider(d, step * direction, metrics.gutter) })
  }

  return (
    <div ref={containerRef} className={cx(styles.layout, (resizing || drag) && styles.interacting)}>
      {Object.entries(geometry.panes).map(([paneId, layoutRect]) => {
        const isMax = maximized === paneId
        // Hidden panes keep their own size so their terminals are not resized needlessly.
        return (
          <div
            key={paneId}
            className={cx(
              styles.slot,
              drag?.paneId === paneId && styles.dragging,
              isMax && styles.maximized,
              maximized && !isMax && styles.concealed
            )}
            aria-hidden={maximized && !isMax ? true : undefined}
            style={isMax || !relative.panes[paneId] ? FULL : placed(relative.panes[paneId]!)}
          >
            {renderPane(paneId, {
              onDragHandlePointerDown: (event) => (maximized ? undefined : startDrag(paneId, event)),
              dragging: drag?.paneId === paneId,
              maximized: isMax,
              toggleMaximize: () => setMaximizedId(isMax ? null : paneId),
              rect: layoutRect,
              minSize: minFor(paneId),
              gutter: metrics.gutter,
              moveTo: maximized
                ? null
                : (direction) => {
                    const target = neighborOf(geometry.panes, paneId, direction)
                    if (target) onOperation({ type: 'swap', paneId, targetPaneId: target })
                  }
            })}
          </div>
        )
      })}
      {!maximized && geometry.dividers.map((d, i) => {
        const ratio = Math.round((d.ratios[d.index] ?? 0) * 100)
        const horizontal = d.direction === 'horizontal'
        return (
          <div
            key={dividerKey(d)}
            role="separator"
            tabIndex={0}
            aria-orientation={horizontal ? 'vertical' : 'horizontal'}
            aria-label="Resize panes"
            aria-valuenow={ratio}
            aria-valuemin={0}
            aria-valuemax={100}
            className={cx(styles.divider, horizontal ? styles.dividerColumn : styles.dividerRow, resizing?.key === dividerKey(d) && styles.dividerActive)}
            style={relative.dividers[i] ? placed(relative.dividers[i]!) : { left: d.rect.x, top: d.rect.y, width: d.rect.width, height: d.rect.height }}
            onPointerDown={(e) => startResize(d, e)}
            onKeyDown={(e) => {
              const back = horizontal ? 'ArrowLeft' : 'ArrowUp'
              const forward = horizontal ? 'ArrowRight' : 'ArrowDown'
              if (e.key === back || e.key === forward) {
                e.preventDefault()
                nudge(d, e.key === forward ? 1 : -1)
              }
            }}
          />
        )
      })}
      {drag && <PaneDropPreview target={drag.target} swap={drag.swap} container={bounds} showArrangeBar={drag.inArrangeBand} />}
    </div>
  )
}
