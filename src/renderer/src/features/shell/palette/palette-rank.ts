/** One thing the command palette can do (ADR 0060). */
export interface PaletteItem {
  id: string
  label: string
  /** Where it belongs: "Go to", "Open", "Settings"… */
  group: string
  /** Searched too, shown dim (a Workspace's name for a worktree). */
  hint?: string
  /** Its shortcut, as the platform writes it. */
  keys?: string
  run: () => void
}

/**
 * How well one query word fits a text: a whole-word start beats a word start, beats anywhere,
 * beats letters in order ("nwt" → "New worktree", one-word queries only: with several words it
 * would match almost anything); -1 when it does not fit.
 */
const wordScore = (word: string, text: string, loose: boolean): number => {
  const at = text.indexOf(word)
  if (at === 0) return 100
  if (at > 0) return /[\s/·:-]/.test(text[at - 1]!) ? 80 - Math.min(at, 20) : 50 - Math.min(at, 20)
  if (!loose) return -1
  let from = 0
  let gaps = 0
  for (const ch of word) {
    const next = text.indexOf(ch, from)
    if (next < 0) return -1
    gaps += next - from
    from = next + 1
  }
  return Math.max(1, 30 - gaps)
}

/** The items that fit every word of the query, best first; an empty query keeps their order. */
export function rankPalette(items: PaletteItem[], query: string): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return items
  return items
    .map((item, index) => {
      const label = item.label.toLowerCase()
      const all = `${label} ${(item.hint ?? '').toLowerCase()} ${item.group.toLowerCase()}`
      let score = 0
      const loose = words.length === 1
      for (const word of words) {
        // The label counts more than the hint or group.
        const s = Math.max(wordScore(word, label, loose) * 1.5, wordScore(word, all, loose))
        if (s < 0) return null
        score += s
      }
      return { item, score, index }
    })
    .filter((r): r is { item: PaletteItem; score: number; index: number } => r !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item)
}

/**
 * Ranked items gathered under their groups, so each group is one titled section: groups keep the order
 * of their best match, items keep their rank inside a group.
 */
export function groupRanked(items: PaletteItem[]): Array<{ group: string; items: PaletteItem[] }> {
  const sections = new Map<string, PaletteItem[]>()
  for (const item of items) {
    const list = sections.get(item.group)
    if (list) list.push(item)
    else sections.set(item.group, [item])
  }
  return [...sections].map(([group, list]) => ({ group, items: list }))
}
