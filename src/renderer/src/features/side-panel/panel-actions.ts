import { api } from '../../lib/api'
import { useSettings } from '../../stores/data'
import { useNavigation, type PanelGroup } from '../../stores/navigation'
import { runAction } from '../../stores/notices'

/** Opens a browser page for a folder scope and selects its side-panel tab. Shared by the panel's "+" and Queen Bee. */
export async function openBrowserTab(scope: string, group: PanelGroup = 'top'): Promise<boolean> {
  const homeUrl = useSettings.getState().settings.browserHomeUrl
  const page = await runAction('Open browser', () => api('browser.open', { scope, url: homeUrl || undefined }))
  if (page) useNavigation.getState().addPanelTab(scope, 'browser', page.id, true, group)
  return Boolean(page)
}
