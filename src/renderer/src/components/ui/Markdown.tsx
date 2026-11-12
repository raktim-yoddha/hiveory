import { memo, useMemo, useState } from 'react'
import DOMPurify from 'dompurify'
import { markdownBlocks, markdownCache, markdownHtml } from './markdown-blocks'
import styles from './Markdown.module.css'

// Links open in the system browser (the window's open handler denies in-app navigation).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

const sanitize = (html: string): string => DOMPurify.sanitize(html, { USE_PROFILES: { html: true }, FORBID_TAGS: ['style', 'form', 'input', 'img'] })

/**
 * Renders agent markdown safely: GFM via marked, then sanitized with DOMPurify (no raw HTML
 * execution). While a reply streams it is drawn block by block, so each update redraws only the
 * block still being written (ADR 0068); once it ends it is drawn whole, exactly as before.
 */
export function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  return streaming ? <StreamingMarkdown text={text} /> : <WholeMarkdown text={text} />
}

function WholeMarkdown({ text }: { text: string }) {
  const html = useMemo(() => sanitize(markdownHtml(text)), [text])
  return <div className={styles.md} dangerouslySetInnerHTML={{ __html: html }} />
}

function StreamingMarkdown({ text }: { text: string }) {
  const [cache] = useState(markdownCache)
  const blocks = useMemo(() => markdownBlocks(text, cache), [text, cache])
  return (
    <div className={styles.md}>
      {blocks.map((block, i) =>
        // Blank lines make no HTML: no element, so the first and last real blocks keep their edge margins.
        block.html ? <Block key={i} html={block.html} /> : null
      )}
    </div>
  )
}

/** One block's HTML: unchanged blocks keep their DOM, and are sanitized once. */
const Block = memo(function Block({ html }: { html: string }) {
  const clean = useMemo(() => sanitize(html), [html])
  return <div className={styles.block} dangerouslySetInnerHTML={{ __html: clean }} />
})
