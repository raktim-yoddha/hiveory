import type { BrowserAnnotation } from './browser'

type Note = Pick<BrowserAnnotation, 'url' | 'element' | 'note' | 'intent'>

const where = (a: Pick<BrowserAnnotation, 'element'>): string => `${a.element.role}${a.element.name ? ` "${a.element.name}"` : ''}`

/**
 * Browser notes as one prompt for an agent (ADR 0042). A note is either a change to make or a question
 * to answer, and they ask for different work: changes are made and checked; questions are answered
 * from the code and the page, without changing anything for them. Each keeps the number it has on the
 * page, with the element and how to find it. Shared by Send and Copy.
 */
export const annotationsText = (notes: Note[]): string => {
  const pages = [...new Set(notes.map((n) => n.url))]
  const item = (n: Note): string =>
    [
      `${notes.indexOf(n) + 1}. ${where(n)}: ${n.note}`,
      pages.length > 1 ? `   page: ${n.url}` : '',
      `   selector: ${n.element.selector}`,
      n.element.text ? `   text: ${n.element.text.slice(0, 200)}` : ''
    ]
      .filter(Boolean)
      .join('\n')
  const changes = notes.filter((n) => n.intent !== 'question')
  const questions = notes.filter((n) => n.intent === 'question')
  return [
    `Feedback on ${pages.length === 1 ? pages[0] : `${pages.length} pages`}, numbered as marked on the page.`,
    ...(changes.length ? ['', `Make these ${changes.length === 1 ? 'change' : `${changes.length} changes`}:`, ...changes.map(item)] : []),
    ...(questions.length
      ? ['', `Answer ${questions.length === 1 ? 'this question' : `these ${questions.length} questions`} from the code and the page. Do not change anything for ${questions.length === 1 ? 'it' : 'them'}:`, ...questions.map(item)]
      : []),
    '',
    [changes.length ? 'Check each change in the page with the hiveory browser tools.' : '', questions.length ? 'Answer each question by its number.' : ''].filter(Boolean).join(' ')
  ].join('\n')
}
