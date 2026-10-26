import { useEffect, type ReactNode } from 'react'
import type { BrowserPageView } from '@shared/domain/browser'
import { api } from '../../lib/api'
import { useBrowser } from '../../stores/browser'
import { PaneFrame } from '../panes/PaneFrame'
import { registerPaneCloser } from '../panes/pane-commands'
import type { PaneRenderProps } from '../panes/PaneLayout'
import { BrowserPane } from './BrowserPane'
import { pageTitle } from './page-title'

/**
 * A browser page as a pane among the agents (ADR 0042): same tabs, drag, split and maximize as any
 * pane. The page itself is main's native view laid over the pane, so it steps aside while hidden.
 */
export function BrowserPaneFrame({
  page,
  onDragHandlePointerDown,
  toggleMaximize,
  concealed,
  tabStrip,
  highlighted
}: PaneRenderProps & { page: BrowserPageView; tabStrip: ReactNode; highlighted?: boolean }) {
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
    >
      <BrowserPane pageId={page.id} visible={!concealed} />
    </PaneFrame>
  )
}
