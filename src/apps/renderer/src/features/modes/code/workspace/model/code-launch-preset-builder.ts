import type { CodeLaunchPresetEntry, CodeLaunchPresetPaneKind } from '../../../../../shared/api/hiveory-client'

// Keep preset editing pleasant offline. The host remains the authority for
// final pane names at launch, using the same catalog and collision checks.
const PET_NAMES = ['Biscuit', 'Button', 'Clover', 'Comet', 'Doodle', 'Fidget', 'Gizmo', 'Juniper', 'Kestrel', 'Mochi', 'Nimbus', 'Noodle', 'Pebble', 'Pickle', 'Pippin', 'Poppy', 'Quartz', 'Rocket', 'Saffron', 'Sprout', 'Tango', 'Waffles', 'Whisker', 'Wicket', 'Ziggy']

export interface CodeLaunchPresetGroup {
  key: string
  kind: CodeLaunchPresetPaneKind
  adapterId: string | null
  launchMode: CodeLaunchPresetEntry['agent_launch_mode']
  url: string | null
  entries: CodeLaunchPresetEntry[]
}

const titleKey = (title: string) => title.trim().toLocaleLowerCase()

export const entryGroupKey = (entry: Pick<CodeLaunchPresetEntry, 'kind' | 'adapter_id' | 'agent_launch_mode' | 'url'>): string =>
  [entry.kind, entry.adapter_id ?? '', entry.agent_launch_mode, entry.url ?? ''].join('\u0000')

export const groupPresetEntries = (entries: CodeLaunchPresetEntry[]): CodeLaunchPresetGroup[] => {
  const groups = new Map<string, CodeLaunchPresetGroup>()
  for (const entry of entries) {
    const key = entryGroupKey(entry)
    const group = groups.get(key)
    if (group) group.entries.push(entry)
    else groups.set(key, { key, kind: entry.kind, adapterId: entry.adapter_id, launchMode: entry.agent_launch_mode, url: entry.url, entries: [entry] })
  }
  return [...groups.values()]
}

/** Produces a friendly pane title while guaranteeing uniqueness among the supplied titles. */
export const nextPetPaneTitle = (existingTitles: readonly string[], seed = Math.floor(Math.random() * PET_NAMES.length)): string => {
  const used = new Set(existingTitles.map(titleKey))
  for (let offset = 0; offset < PET_NAMES.length; offset += 1) {
    const candidate = PET_NAMES[(seed + offset) % PET_NAMES.length]
    if (!used.has(titleKey(candidate))) return candidate
  }
  let suffix = 2
  const base = PET_NAMES[0]
  while (used.has(titleKey(`${base}${suffix}`))) suffix += 1
  return `${base}${suffix}`
}

export const hasDuplicatePaneTitles = (entries: readonly Pick<CodeLaunchPresetEntry, 'title'>[]): boolean => {
  const titles = new Set<string>()
  for (const entry of entries) {
    const key = titleKey(entry.title)
    if (!key || titles.has(key)) return true
    titles.add(key)
  }
  return false
}
