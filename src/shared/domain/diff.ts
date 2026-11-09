/** A unified diff read for showing (ADR 0058, 0060): shared by the desktop's Changes tab and the phone's. Dependency-free. */

/** One line to show; `old` and `new` are its numbers in the old and new file (the review pane shows them, ADR 0064). */
export type DiffLine = { kind: 'hunk' | 'add' | 'del' | 'context' | 'note'; text: string; old?: number; new?: number }

/** A unified diff's body as lines to color: headers dropped, hunks kept as separators. */
export const diffLines = (patch: string): DiffLine[] => {
  const lines: DiffLine[] = []
  let body = false
  let oldNo = 0
  let newNo = 0
  for (const line of patch.split(/\r?\n/)) {
    if (line.startsWith('@@')) {
      body = true
      const at = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line)
      oldNo = at ? Number(at[1]) : 0
      newNo = at ? Number(at[2]) : 0
      lines.push({ kind: 'hunk', text: line })
    } else if (!body) {
      if (line.startsWith('Binary files')) lines.push({ kind: 'note', text: 'Binary file' })
    } else if (line.startsWith('diff --git')) body = false
    else if (line.startsWith('+')) lines.push({ kind: 'add', text: line.slice(1), new: newNo++ })
    else if (line.startsWith('-')) lines.push({ kind: 'del', text: line.slice(1), old: oldNo++ })
    else if (line.startsWith('\\')) lines.push({ kind: 'note', text: line.slice(2) })
    else if (line) lines.push({ kind: 'context', text: line.slice(1), old: oldNo++, new: newNo++ })
  }
  return lines
}

/** "1.9k" for counts past a thousand, as diff stats are usually shown. */
export const shortCount = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}k` : String(n))
