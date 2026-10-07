/**
 * The single naming service for agent pet names and Workspace names
 * (AGENTS.md rule 17). UI components never generate names themselves.
 */

export const PET_NAMES = [
  'Milo', 'Luna', 'Kai', 'Ruby', 'Max', 'Nova', 'Otis', 'Ivy', 'Juno', 'Leo',
  'Pip', 'Hazel', 'Finn', 'Mabel', 'Ziggy', 'Olive', 'Bruno', 'Cleo', 'Rex', 'Poppy',
  'Arlo', 'Willow', 'Gus', 'Daisy', 'Theo', 'Maple', 'Bodhi', 'Fern', 'Loki', 'Pearl',
  'Ollie', 'Sage', 'Biscuit', 'Wren', 'Toby', 'Nala', 'Rocco', 'Iris', 'Moss', 'Coco',
  'Jasper', 'Penny', 'Remy', 'Skye', 'Bear', 'Lark', 'Echo', 'Fig', 'Mochi', 'Basil'
] as const

const WORKSPACE_ADJECTIVES = [
  'Amber', 'Quiet', 'Copper', 'Silver', 'Hidden', 'Bright', 'Misty', 'Golden', 'Swift', 'Still',
  'Velvet', 'Crimson', 'Lunar', 'Polar', 'Cedar', 'Iron', 'Hollow', 'Wild', 'Calm', 'Northern'
] as const

const WORKSPACE_NOUNS = [
  'Harbor', 'Ridge', 'Meadow', 'Canyon', 'Grove', 'Summit', 'Delta', 'Valley', 'Fjord', 'Mesa',
  'Brook', 'Glade', 'Atoll', 'Bluff', 'Cove', 'Dune', 'Marsh', 'Peak', 'Reef', 'Hollow'
] as const

export type RandomSource = () => number

const pick = <T>(items: readonly T[], random: RandomSource): T =>
  items[Math.min(items.length - 1, Math.floor(random() * items.length))] as T

const lower = (names: Iterable<string>): Set<string> => new Set([...names].map((n) => n.toLowerCase()))

/**
 * Picks a pet name not in `taken` (case-insensitive). When the vocabulary is
 * exhausted, falls back to numbered names ("Milo 2") so names stay unique.
 */
export const generatePetName = (taken: Iterable<string>, random: RandomSource = Math.random): string => {
  const used = lower(taken)
  const free = PET_NAMES.filter((n) => !used.has(n.toLowerCase()))
  if (free.length > 0) return pick(free, random)
  for (let suffix = 2; ; suffix++) {
    const numbered = PET_NAMES.map((n) => `${n} ${suffix}`).filter((n) => !used.has(n.toLowerCase()))
    if (numbered.length > 0) return pick(numbered, random)
  }
}

/** Generates `count` distinct pet names that are also distinct from `taken`. */
export const generatePetNames = (count: number, taken: Iterable<string>, random: RandomSource = Math.random): string[] => {
  const used = [...taken]
  const names: string[] = []
  for (let i = 0; i < count; i++) {
    const name = generatePetName(used, random)
    names.push(name)
    used.push(name)
  }
  return names
}

export const generateWorkspaceName = (taken: Iterable<string>, random: RandomSource = Math.random): string => {
  const used = lower(taken)
  for (let attempt = 0; attempt < 50; attempt++) {
    const name = `${pick(WORKSPACE_ADJECTIVES, random)} ${pick(WORKSPACE_NOUNS, random)}`
    if (!used.has(name.toLowerCase())) return name
  }
  for (let suffix = 2; ; suffix++) {
    const name = `Worktree ${suffix}`
    if (!used.has(name.toLowerCase())) return name
  }
}

/** Lowercase, Git- and filesystem-safe slug: `[a-z0-9-]`, never empty. */
export const slugify = (value: string, fallback = 'workspace'): string => {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '')
  return slug || fallback
}

/** Returns `base`, or the first free `base-2`, `base-3`… candidate. */
export const uniqueName = (base: string, isTaken: (candidate: string) => boolean): string => {
  if (!isTaken(base)) return base
  for (let i = 2; ; i++) {
    const candidate = `${base}-${i}`
    if (!isTaken(candidate)) return candidate
  }
}
