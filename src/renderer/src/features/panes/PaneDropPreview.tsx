import { ArrowLeftRight, Columns3, LayoutGrid, PanelLeft } from 'lucide-react'
import type { ArrangeMode } from '@shared/domain'
import { arrangeBarRects, type DropTarget } from '@shared/layout/drop'
import type { Rect } from '@shared/layout/geometry'
import { cx } from '../../lib/cx'
import styles from './PaneLayout.module.css'

const ARRANGE_ICONS: Record<ArrangeMode, typeof LayoutGrid> = { equal: LayoutGrid, focus: PanelLeft, columns: Columns3 }

interface PaneDropPreviewProps {
  target: DropTarget | null
  swap: boolean
  container: Rect
  showArrangeBar: boolean
}

/** Shows exactly where a dragged pane will land, the top arrange bar, and the Space-to-swap hint. */
export function PaneDropPreview({ target, swap, container, showArrangeBar }: PaneDropPreviewProps) {
  return (
    <>
      {target && target.kind !== 'arrange' && (
        <div
          className={styles.preview}
          data-kind={target.kind}
          style={{ left: target.preview.x, top: target.preview.y, width: target.preview.width, height: target.preview.height }}
          aria-hidden
        >
          {target.kind === 'swap' && (
            <span className={styles.previewLabel}>
              <ArrowLeftRight /> Swap
            </span>
          )}
        </div>
      )}
      {showArrangeBar &&
        arrangeBarRects(container).map(({ mode, label, rect }) => {
          const Icon = ARRANGE_ICONS[mode]
          const active = target?.kind === 'arrange' && target.mode === mode
          return (
            <div
              key={mode}
              className={cx(styles.arrangeOption, active && styles.arrangeActive)}
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
              aria-hidden
            >
              <Icon />
              {label}
            </div>
          )
        })}
      <div className={styles.dragHint} role="status">
        {showArrangeBar
          ? 'Release on a layout to arrange every pane'
          : swap
            ? 'Release over a pane to swap'
            : 'Drop on an edge to dock · Hold Space to swap · Top edge to arrange'}
      </div>
    </>
  )
}
