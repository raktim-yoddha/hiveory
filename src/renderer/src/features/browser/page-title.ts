import type { BrowserPageView } from '@shared/domain/browser'

/** A browser tab's label: the page title, else its host, else "New tab". */
export function pageTitle(page: Pick<BrowserPageView, 'title' | 'url'>): string {
  if (page.title && page.title !== page.url) return page.title
  try {
    return page.url && page.url !== 'about:blank' ? new URL(page.url).host : 'New tab'
  } catch {
    return 'New tab'
  }
}
