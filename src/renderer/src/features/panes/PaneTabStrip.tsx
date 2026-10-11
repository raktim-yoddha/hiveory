import { useState, type ReactNode } from 'react'
import { Maximize2, Minimize2, PanelBottom, PanelRight, Pencil, X } from 'lucide-react'
import type { CliStatus, LayoutOperation } from '@shared/domain'
import { IconButton } from '../../components/ui/Button'
import { InlineRename } from '../../components/ui/InlineRename'
import { Menu } from '../../components/ui/Menu'
import { StatusDot } from '../../components/ui/StatusDot'
import { cx } from '../../lib/cx'
import { closePane } from './pane-commands'
import type { PaneArea } from './PaneLayout'
import styles from './PaneTabStrip.module.css'

/** What a tab shows for one pane: its name, icon and (for an agent) status. */
export interface PaneTabInfo {
  title: string
  icon: ReactNode
  status?: { status: CliStatus; running: boolean; detail?: string }
  /** Agents and terminals can be renamed (their pet name, ADR 0042). */
  rename?: (name: string) => void
}

interface PaneTabStripProps {
  area: PaneArea
  describe: (paneId: string) => PaneTabInfo | undefined
  onOperation: (operation: LayoutOperation) => void
  maximized: boolean
  toggleMaximize: () => void
  /** The area's "+": a new pane opens as a tab here. */
  add: ReactNode
}

/**
 * An area's tabs (tabbed panes, ADR 0042, like Orca): click a tab to show it, drag it out to an edge or
 * into another area, double-click to maximize, right-click for its actions, right-click twice to rename.
 */
export function PaneTabStrip({ area, describe, onOperation, maximized, toggleMaximize, add }: PaneTabStripProps) {
  const [renaming, setRenaming] = useState<string | null>(null)
  const others = (id: string): string | undefined => area.paneIds.find((p) => p !== id)

  return (
    <div className={styles.strip} role="tablist" aria-label="Panes in this area">
      {area.paneIds.map((id) => {
        const info = describe(id)
        if (!info) return null
        const selected = id === area.active
        const sibling = others(id)
        const split = (side: 'right' | 'bottom'): void => {
          if (sibling) onOperation({ type: 'move', paneId: id, targetPaneId: sibling, side })
        }
        return (
          <div
            key={id}
            className={cx(styles.tab, selected && styles.selected)}
            onPointerDown={(e) => {
              // This tab is dragged, not the area's shown pane (the header's own handle).
              e.stopPropagation()
              area.dragHandle(id)(e)
            }}
          >
            {renaming === id && info.rename ? (
              <span className={styles.tabButton}>
                {info.icon}
                <InlineRename value={info.title} label={`Rename ${info.title}`} onCommit={info.rename} onDone={() => setRenaming(null)} />
              </span>
            ) : (
              <Menu
                label={`${info.title} actions`}
                context
                onDoubleContext={info.rename ? () => setRenaming(id) : undefined}
                items={[
                  ...(info.rename ? [{ type: 'item' as const, id: 'rename', label: 'Rename', icon: <Pencil />, hint: 'Right-click twice', onSelect: () => setRenaming(id) }] : []),
                  { type: 'item', id: 'split-right', label: 'Split right', icon: <PanelRight />, disabled: !sibling, onSelect: () => split('right') },
                  { type: 'item', id: 'split-down', label: 'Split down', icon: <PanelBottom />, disabled: !sibling, onSelect: () => split('bottom') },
                  { type: 'separator' },
                  { type: 'item', id: 'close', label: 'Close', icon: <X />, danger: true, onSelect: () => closePane(id) }
                ]}
                trigger={(props) => (
                  <button
                    type="button"
                    {...props}
                    role="tab"
                    aria-selected={selected}
                    data-pane-grip
                    className={styles.tabButton}
                    title={`${info.title}\nDouble-click to maximize · right-click for actions, twice to rename`}
                    onClick={() => area.activate(id)}
                    onAuxClick={(e) => e.button === 1 && closePane(id)}
                  >
                    {info.icon}
                    <span className={styles.title}>{info.title}</span>
                    {info.status && <StatusDot status={info.status.status} running={info.status.running} detail={info.status.detail} />}
                  </button>
                )}
              />
            )}
            <button type="button" className={styles.close} aria-label={`Close ${info.title}`} onClick={() => closePane(id)}>
              <X aria-hidden />
            </button>
          </div>
        )
      })}
      <span className={styles.actions}>
        {add}
        <IconButton data-pane-optional="maximize" label={maximized ? 'Restore area' : 'Maximize area'} icon={maximized ? <Minimize2 /> : <Maximize2 />} onClick={toggleMaximize} />
      </span>
    </div>
  )
}
