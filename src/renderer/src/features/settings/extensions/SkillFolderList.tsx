import { useState } from 'react'
import { Check, Search } from 'lucide-react'
import type { SkillRoot } from '@shared/domain'
import { CliStack } from '../../../components/cli/CliStack'
import { TextInput } from '../../../components/ui/TextField'
import { cx } from '../../../lib/cx'
import { useClis } from '../../../stores/data'
import styles from './SkillFolderList.module.css'

/** Past this many folders the list gets a filter box. */
const SEARCH_FROM = 6

/**
 * Skills folders as one checklist: each row is a folder, the CLIs that read it,
 * and a check. It scales to any number of CLIs (scrolls, filters by folder or CLI
 * name) instead of a chip per CLI. Used on a skill row and in "New skill".
 */
export function SkillFolderList({ roots, isOn, onToggle }: { roots: SkillRoot[]; isOn: (root: SkillRoot) => boolean; onToggle: (root: SkillRoot) => void }) {
  const clis = useClis((s) => s.clis)
  const installed = new Set(clis.filter((c) => c.available).map((c) => c.id))
  const [query, setQuery] = useState('')
  const name = (id: string) => clis.find((c) => c.id === id)?.displayName ?? id
  const q = query.trim().toLowerCase()
  const shown = roots.filter((r) => !q || r.label.toLowerCase().includes(q) || r.dir.includes(q) || r.visibleTo.some((id) => name(id).toLowerCase().includes(q)))

  return (
    <div className={styles.picker}>
      {roots.length > SEARCH_FROM && (
        <label className={styles.search}>
          <Search aria-hidden />
          <TextInput aria-label="Filter folders" placeholder="Filter folders or CLIs" value={query} onChange={setQuery} />
        </label>
      )}
      <ul className={styles.list} role="group" aria-label="Skills folders">
        {shown.map((root) => {
          const on = isOn(root)
          const readers = root.visibleTo.filter((id) => installed.has(id))
          return (
            <li key={root.id}>
              <button type="button" role="checkbox" aria-checked={on} className={cx(styles.row, on && styles.on)} onClick={() => onToggle(root)}>
                <span className={styles.check} aria-hidden>
                  {on && <Check />}
                </span>
                <span className={styles.text}>
                  <span className={styles.label}>{root.label}</span>
                  <span className={styles.path}>~/{root.dir}</span>
                </span>
                <CliStack cliIds={readers.length ? readers : root.visibleTo} max={3} />
              </button>
            </li>
          )
        })}
        {shown.length === 0 && <li className={styles.none}>No folder matches.</li>}
      </ul>
    </div>
  )
}
