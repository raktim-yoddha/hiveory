import type { BrowserPageView } from '@shared/domain/browser'
import { api } from '../../lib/api'
import { useSettings } from '../../stores/data'
import { runAction } from '../../stores/notices'

/** Opens a browser page as a pane of a worktree (ADR 0042), beside a pane or docked at the right. */
export async function openBrowserPane(workspaceId: string, options: { url?: string; beside?: { paneId: string; side: 'right' | 'bottom' | 'tab' } } = {}): Promise<BrowserPageView | undefined> {
  const homeUrl = useSettings.getState().settings.browserHomeUrl
  return runAction('Open browser', () => api('browser.open', { scope: workspaceId, url: options.url ?? (homeUrl || undefined), ...(options.beside ? { beside: options.beside } : {}) }))
}
