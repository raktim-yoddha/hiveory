import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { cx } from '../../lib/cx'
import { TextInput } from './TextField'
import styles from './EmojiPicker.module.css'

interface Emoji {
  char: string
  name: string
  group: string
}

/** Every emoji with its name and group, loaded the first time a picker opens (unicode-emoji-json). */
let cache: Promise<Emoji[]> | null = null
const loadEmoji = (): Promise<Emoji[]> =>
  (cache ??= import('unicode-emoji-json/data-by-emoji.json').then((m) =>
    Object.entries(m.default as Record<string, { name: string; group: string }>).map(([char, e]) => ({ char, name: e.name, group: e.group }))
  ))

/** Every emoji, by group, with a search over names and groups (ADR 0043). */
export function EmojiPicker({ value, onPick }: { value?: string; onPick: (emoji: string) => void }) {
  const [all, setAll] = useState<Emoji[] | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    let live = true
    void loadEmoji().then((list) => live && setAll(list))
    return () => {
      live = false
    }
  }, [])

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const shown = (all ?? []).filter((e) => !q || e.name.includes(q) || e.group.toLowerCase().includes(q))
    const map = new Map<string, Emoji[]>()
    for (const e of shown) map.set(e.group, [...(map.get(e.group) ?? []), e])
    return [...map.entries()]
  }, [all, query])

  return (
    <div className={styles.picker}>
      <label className={styles.search}>
        <Search aria-hidden />
        <TextInput type="search" aria-label="Search emoji" placeholder="Search emoji — rocket, cat, heart…" value={query} onChange={setQuery} />
      </label>
      <div className={styles.scroll}>
        {!all ? (
          <p className={styles.empty}>Loading emoji…</p>
        ) : groups.length === 0 ? (
          <p className={styles.empty}>No emoji match.</p>
        ) : (
          groups.map(([group, list]) => (
            <section key={group} aria-label={group}>
              <h4 className={styles.group}>{group}</h4>
              <div className={styles.grid} role="listbox" aria-label={group}>
                {list.map((e) => (
                  <button
                    key={e.char}
                    type="button"
                    role="option"
                    aria-selected={value === e.char}
                    aria-label={e.name}
                    title={e.name}
                    className={cx(styles.emoji, value === e.char && styles.on)}
                    onClick={() => onPick(e.char)}
                  >
                    {e.char}
                  </button>
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </div>
  )
}
