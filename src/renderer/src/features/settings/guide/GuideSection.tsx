import { useMemo, useState } from 'react'
import { ArrowLeft, Search } from 'lucide-react'
import { Button } from '../../../components/ui/Button'
import { TextInput } from '../../../components/ui/TextField'
import { cx } from '../../../lib/cx'
import { GUIDE, type GuideChapter } from './guide-content'
import styles from './Guide.module.css'

const textOf = (node: unknown): string => {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join(' ')
  if (typeof node === 'object' && 'props' in (node as object)) return textOf((node as { props: { children?: unknown } }).props.children)
  return ''
}

/** The Hiveory field guide: searchable chapter cards that open into a reader. */
export function GuideSection() {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState<GuideChapter | null>(null)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return GUIDE
    return GUIDE.filter((c) =>
      [c.title, c.summary, ...c.sections.map((s) => `${s.heading} ${s.keywords ?? ''} ${textOf(s.body)}`)]
        .join(' ')
        .toLowerCase()
        .includes(q)
    )
  }, [query])

  if (open) {
    const index = GUIDE.indexOf(open)
    const next = GUIDE[index + 1]
    return (
      <div className={styles.reader}>
        <aside className={styles.toc}>
          <Button variant="ghost" size="sm" icon={<ArrowLeft />} onClick={() => setOpen(null)}>
            All chapters
          </Button>
          <span className={styles.tocLabel}>Chapter {String(index + 1).padStart(2, '0')}</span>
          <ul>
            {open.sections.map((s) => (
              <li key={s.heading}>
                <a href={`#guide-${open.id}-${s.heading}`}>{s.heading}</a>
              </li>
            ))}
          </ul>
        </aside>
        <article className={styles.article}>
          <span className={styles.kicker}>
            <open.icon aria-hidden /> Chapter {String(index + 1).padStart(2, '0')}
          </span>
          <h2 className={styles.articleTitle}>{open.title}</h2>
          <p className={styles.lede}>{open.summary}</p>
          {open.sections.map((s) => (
            <section key={s.heading} id={`guide-${open.id}-${s.heading}`} className={styles.section}>
              <h3>{s.heading}</h3>
              {s.body}
            </section>
          ))}
          {next && (
            <button type="button" className={styles.next} onClick={() => setOpen(next)}>
              <span>Next chapter</span>
              <b>{next.title}</b>
            </button>
          )}
        </article>
      </div>
    )
  }

  return (
    <div className={styles.home}>
      <header className={styles.hero}>
        <span className={styles.kicker}>Field guide</span>
        <h2 className={styles.heroTitle}>Everything Hiveory can do</h2>
        <p className={styles.lede}>Short chapters you can read in a minute. Search for a feature or pick a chapter.</p>
        <label className={styles.search}>
          <Search aria-hidden />
          <TextInput aria-label="Search the guide" placeholder="Search — e.g. swap, branch, paste" value={query} onChange={setQuery} />
        </label>
      </header>
      <div className={styles.grid}>
        {matches.map((chapter) => {
          const number = GUIDE.indexOf(chapter) + 1
          return (
            <button key={chapter.id} type="button" className={styles.card} onClick={() => setOpen(chapter)}>
              <span className={styles.cardTop}>
                <span className={styles.cardIcon}>
                  <chapter.icon aria-hidden />
                </span>
                <span className={styles.cardNumber}>{String(number).padStart(2, '0')}</span>
              </span>
              <span className={styles.cardTitle}>{chapter.title}</span>
              <span className={styles.cardSummary}>{chapter.summary}</span>
            </button>
          )
        })}
        {matches.length === 0 && <p className={cx(styles.lede, styles.none)}>Nothing matches “{query}”.</p>}
      </div>
    </div>
  )
}
