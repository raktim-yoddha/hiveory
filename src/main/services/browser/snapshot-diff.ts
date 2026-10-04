/**
 * What changed between two snapshots of the same page, line by line (as a
 * multiset, so moved lines are not reported). Lets an action return only
 * what it changed instead of the whole page — fewer tokens, faster turns.
 */
export const diffLines = (before: string[], after: string[]): { added: string[]; removed: string[] } => {
  const counts = new Map<string, number>()
  for (const line of before) counts.set(line, (counts.get(line) ?? 0) + 1)
  const added: string[] = []
  for (const line of after) {
    const n = counts.get(line) ?? 0
    if (n > 0) counts.set(line, n - 1)
    else added.push(line)
  }
  const removed: string[] = []
  for (const line of before) {
    const n = counts.get(line) ?? 0
    if (n > 0) {
      removed.push(line)
      counts.set(line, n - 1)
    }
  }
  return { added, removed }
}

/** A diff is worth sending only when it is clearly smaller than the page. */
export const diffWorthIt = (diff: { added: string[]; removed: string[] }, total: number): boolean =>
  diff.added.length + diff.removed.length <= Math.max(12, Math.floor(total * 0.5))
