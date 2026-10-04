import { ArrowLeftRight } from 'lucide-react'
import type { DropTarget } from '@shared/layout/drop'
import styles from './PaneLayout.module.css'

/** Shows exactly where a dragged pane will land, plus a hint about Space-to-swap. */
export function PaneDropPreview({ target, swap }: { target: DropTarget | null; swap: boolean }) {
  return (
    <>
      {target && (
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
      <div className={styles.dragHint} role="status">
        {swap ? 'Release over a pane to swap' : 'Drop on an edge to dock · Hold Space to swap'}
      </div>
    </>
  )
}
