/** The latest GitHub release, as the phone needs it: its version, highlights and where the APK is. */
export interface PhoneRelease {
  version: string
  highlights: string[]
  /** The APK to install, or the release page when a release has none. */
  url: string
}

export const LATEST_RELEASE_API = 'https://api.github.com/repos/raktim-yoddha/hiveory/releases/latest'

const core = (v: string): number[] | null => {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v.trim())
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** True when `candidate` is a higher MAJOR.MINOR.PATCH than `current` (prereleases are never offered). */
export const isNewer = (candidate: string, current: string): boolean => {
  const a = core(candidate)
  const b = core(current)
  if (!a || !b || candidate.includes('-')) return false
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!
  return false
}

/** The bullet lines under the release body's "Highlights" heading, as plain text. */
export const highlightsOf = (body: string, max = 3): string[] => {
  const section = /^#+\s*Highlights\s*$([\s\S]*?)(?=^#+\s|(?![\s\S]))/im.exec(body)?.[1] ?? ''
  return section
    .split(/\r?\n/)
    .filter((l) => /^\s*[-*]\s+/.test(l))
    .map((l) => l.replace(/^\s*[-*]\s+/, '').replace(/[*_`]/g, '').trim())
    .filter(Boolean)
    .slice(0, max)
}

interface GitHubRelease {
  tag_name?: unknown
  body?: unknown
  html_url?: unknown
  draft?: unknown
  prerelease?: unknown
  assets?: { name?: unknown; browser_download_url?: unknown }[]
}

/** Reads GitHub's "latest release" answer; anything malformed is treated as "no update". */
export const parseRelease = (json: unknown): PhoneRelease | null => {
  const r = json as GitHubRelease
  if (!r || typeof r.tag_name !== 'string' || r.draft || r.prerelease) return null
  const apk = r.assets?.find((a) => typeof a.name === 'string' && a.name.endsWith('.apk') && typeof a.browser_download_url === 'string')
  const url = (apk?.browser_download_url ?? r.html_url) as string | undefined
  if (!url || !url.startsWith('https://github.com/')) return null
  return { version: r.tag_name.replace(/^v/, ''), highlights: highlightsOf(typeof r.body === 'string' ? r.body : ''), url }
}

export const fetchLatestRelease = async (fetcher: typeof fetch = fetch): Promise<PhoneRelease | null> => {
  const response = await fetcher(LATEST_RELEASE_API, { headers: { Accept: 'application/vnd.github+json' } })
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  return parseRelease(await response.json())
}
