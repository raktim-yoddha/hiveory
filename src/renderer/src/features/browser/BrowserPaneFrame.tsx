import { useEffect, type ReactNode } from 'react'
import { Globe, Maximize2, Minimize2, X } from 'lucide-react'
import type { BrowserPageView } from '@shared/domain/browser'
import { AgentIcon } from '../../components/brand/AgentIcon'
import { IconButton } from '../../components/ui/Button'
import { api } from '../../lib/api'
import { useBrowser } from '../../stores/browser'
import { PaneFrame } from '../panes/PaneFrame'
import { registerPaneCloser } from '../panes/pane-commands'
import type { PaneRenderProps } from '../panes/PaneLayout'
import { BrowserPane } from './BrowserPane'
import { pageTitle } from './page-title'
import styles from '../editor/Editor.module.css'

/**
 * A browser page as a pane among the agents (ADR 0042): same header, drag, split and maximize as any
 * pane. The page itself is main's native view laid over the pane, so it steps aside while hidden.
 */
export function BrowserPaneFrame({
  page,
  onDragHandlePointerDown,
  maximized,
  toggleMaximize,
  concealed,
  tabStrip,
  highlighted
}: PaneRenderProps & { page: BrowserPageView; tabStrip?: ReactNode; highlighted?: boolean }) {
  const title = pageTitle(page)
  const focused = useBrowser((s) => s.focusedPageId === page.id)
  useEffect(() => registerPaneCloser(page.id, () => void api('browser.close', { pageId: page.id }).catch(() => undefined)), [page.id])
  const name = page.ownerName ? `${page.ownerName} · ${title}` : title
  return (
    <PaneFrame
      label={`${name} browser`}
      onHeaderPointerDown={onDragHandlePointerDown}
      onHeaderDoubleClick={toggleMaximize}
      tabStrip={tabStrip}
      focused={focused}
      highlighted={highlighted}
      header={
        <>
          <span className={styles.identity} title={page.url}>
            {page.ownerName ? <AgentIcon aria-hidden className={styles.fileIcon} /> : <Globe aria-hidden className={styles.fileIcon} />}
            <span className={styles.name}>{name}</span>
          </span>
          <span className={styles.actions}>
            <IconButton data-pane-optional="maximize" label={maximized ? `Restore ${title}` : `Maximize ${title}`} icon={maximized ? <Minimize2 /> : <Maximize2 />} onClick={toggleMaximize} />
            <IconButton label={`Close ${title}`} icon={<X />} onClick={() => void api('browser.close', { pageId: page.id }).catch(() => undefined)} />
          </span>
        </>
      }
    >
      <BrowserPane pageId={page.id} visible={!concealed} />
    </PaneFrame>
  )
}
