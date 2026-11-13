import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { CaseSensitive, ChevronDown, ChevronUp, Regex, X } from 'lucide-react'
import { IconButton } from '../../components/ui/Button'
import { TextInput } from '../../components/ui/TextField'
import { focusTerminal, terminalSearch } from './terminal-registry'
import { searchDecorations } from './terminal-search'
import styles from './TerminalFindBar.module.css'

const token = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(`--term-${name}`).trim()

/** "3 of 12", or why there is no current match; empty before anything is typed. */
const countText = (query: string, results: { index: number; count: number } | null): string => {
  if (!query || !results) return ''
  if (results.count === 0) return 'No results'
  return results.index < 0 ? `${results.count}+ matches` : `${results.index + 1} of ${results.count}`
}

/**
 * Find in a terminal's scrollback (ADR 0072): every match highlighted and marked on the scrollbar.
 * Enter goes to the next match, Shift+Enter to the previous one, Escape closes and returns to the
 * terminal. `seed` (the terminal's selection when it opened) starts the search.
 */
export function TerminalFindBar({ instanceId, seed, focusKey, onClose }: { instanceId: string; seed: string; focusKey: number; onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState(seed)
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [regex, setRegex] = useState(false)
  const [results, setResults] = useState<{ index: number; count: number } | null>(null)
  const invalid = regex && Boolean(query) && !validRegex(query)

  // Each request (the shortcut again) brings the focus back here with the text selected.
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [focusKey])

  useEffect(() => {
    const found = terminalSearch(instanceId)
    if (!found) return
    const subscription = found.search.onDidChangeResults((e) => setResults({ index: e.resultIndex, count: e.resultCount }))
    return () => {
      subscription.dispose()
      found.search.clearDecorations()
      found.term.clearSelection()
    }
  }, [instanceId])

  const run = (backwards: boolean, incremental = false): void => {
    const found = terminalSearch(instanceId)
    if (!found) return
    // No count shows for an empty or broken pattern, so the old one needs no reset.
    if (!query || invalid) {
      found.search.clearDecorations()
      found.term.clearSelection()
      return
    }
    const options = { caseSensitive, regex, incremental, decorations: searchDecorations(token) }
    if (backwards) found.search.findPrevious(query, options)
    else found.search.findNext(query, options)
  }

  // Typing, or a changed option, searches again from the current match.
  useEffect(() => run(false, true), [query, caseSensitive, regex]) // eslint-disable-line react-hooks/exhaustive-deps

  const close = (): void => {
    onClose()
    focusTerminal(instanceId)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      run(e.shiftKey)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      close()
    }
  }

  return (
    <div className={styles.bar} role="search" aria-label="Find in the terminal" data-terminal-find={instanceId}>
      <TextInput
        ref={input}
        className={styles.input}
        aria-label="Find in the terminal"
        aria-invalid={invalid}
        placeholder="Find"
        value={query}
        onChange={setQuery}
        onKeyDown={onKeyDown}
      />
      <span className={styles.count} aria-live="polite">
        {invalid ? 'Invalid pattern' : countText(query, results)}
      </span>
      <IconButton label="Match case" icon={<CaseSensitive />} active={caseSensitive} aria-pressed={caseSensitive} onClick={() => setCaseSensitive((v) => !v)} />
      <IconButton label="Use a regular expression" icon={<Regex />} active={regex} aria-pressed={regex} onClick={() => setRegex((v) => !v)} />
      <IconButton label="Previous match (Shift Enter)" icon={<ChevronUp />} disabled={!results?.count} onClick={() => run(true)} />
      <IconButton label="Next match (Enter)" icon={<ChevronDown />} disabled={!results?.count} onClick={() => run(false)} />
      <IconButton label="Close (Esc)" icon={<X />} onClick={close} />
    </div>
  )
}

function validRegex(pattern: string): boolean {
  try {
    new RegExp(pattern)
    return true
  } catch {
    return false
  }
}
