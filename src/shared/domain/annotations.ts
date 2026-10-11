import type { BrowserAnnotation } from './browser'

const where = (a: Pick<BrowserAnnotation, 'element'>): string => `${a.element.role}${a.element.name ? ` "${a.element.name}"` : ''}`

/**
 * Browser notes as one message for an agent (ADR 0042): numbered as on the page, each with what it asks
 * (change or question), the element and how to find it. Shared by Send / Copy and `browser_annotations`.
 */
export const annotationsText = (notes: Array<Pick<BrowserAnnotation, 'url' | 'element' | 'note' | 'intent'>>): string => {
  const pages = [...new Set(notes.map((n) => n.url))]
  const head = `Feedback on ${pages.length === 1 ? pages[0] : `${pages.length} pages`} — ${notes.length} ${notes.length === 1 ? 'note' : 'notes'}, numbered as marked on the page:`
  const lines = notes.map((n, i) =>
    [
      `${i + 1}. [${n.intent ?? 'change'}] ${where(n)}: ${n.note}`,
      pages.length > 1 ? `   page: ${n.url}` : '',
      `   selector: ${n.element.selector}`,
      n.element.text ? `   text: ${n.element.text.slice(0, 200)}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  )
  return [head, ...lines, '', 'Make the changes and answer the questions. Open the page with the hiveory browser tools to check your work.'].join('\n')
}
