import { useMemo } from 'react'
import DOMPurify from 'dompurify'
import { marked } from 'marked'
import styles from './Markdown.module.css'

// Links open in the system browser (the window's open handler denies in-app navigation).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/** Renders agent markdown safely: GFM via marked, then sanitized with DOMPurify (no raw HTML execution). */
export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    const raw = marked.parse(text, { gfm: true, breaks: true, async: false }) as string
    return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'img'] })
  }, [text])
  return <div className={styles.md} dangerouslySetInnerHTML={{ __html: html }} />
}
