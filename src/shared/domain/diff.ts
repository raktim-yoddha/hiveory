/** A unified diff read for showing (ADR 0058, 0060): shared by the desktop's Changes tab and the phone's. Dependency-free. */

export type DiffLine = { kind: 'hunk' | 'add' | 'del' | 'context' | 'note'; text: string }

/** A unified diff's body as lines to color: headers dropped, hunks kept as separators. */
export const diffLines = (patch: string): DiffLine[] => {
  const lines: DiffLine[] = []
  let body = false
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('@@')) {
      body = true
      lines.push({ kind: 'hunk', text: line })
    } else if (!body) {
      if (line.startsWith('Binary files')) lines.push({ kind: 'note', text: 'Binary file' })
    } else if (line.startsWith('diff --git')) body = false
    else if (line.startsWith('+')) lines.push({ kind: 'add', text: line.slice(1) })
    else if (line.startsWith('-')) lines.push({ kind: 'del', text: line.slice(1) })
    else if (line.startsWith('\\')) lines.push({ kind: 'note', text: line.slice(2) })
    else if (line) lines.push({ kind: 'context', text: line.slice(1) })
  }
  return lines
}

/** "1.9k" for counts past a thousand, as diff stats are usually shown. */
export const shortCount = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n))
