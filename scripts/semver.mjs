// Semantic Versioning 2.0.0 (https://semver.org) — parsing, precedence and release validation.

/** The official SemVer regex (semver.org, "Is there a suggested regular expression"). */
const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

export const parse = (input) => {
  const match = SEMVER.exec(String(input).trim().replace(/^v/, ''))
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ?? '',
    raw: match[0]
  }
}

const compareIdentifiers = (a, b) => {
  const an = /^\d+$/.test(a)
  const bn = /^\d+$/.test(b)
  if (an && bn) return Number(a) - Number(b)
  if (an) return -1 // numeric identifiers have lower precedence
  if (bn) return 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** SemVer §11 precedence; build metadata is ignored. Returns <0, 0 or >0. */
export const compare = (a, b) => {
  for (const key of ['major', 'minor', 'patch']) if (a[key] !== b[key]) return a[key] - b[key]
  if (!a.prerelease.length && !b.prerelease.length) return 0
  if (!a.prerelease.length) return 1 // a release outranks its prereleases
  if (!b.prerelease.length) return -1
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    if (a.prerelease[i] === undefined) return -1
    if (b.prerelease[i] === undefined) return 1
    const c = compareIdentifiers(a.prerelease[i], b.prerelease[i])
    if (c) return c
  }
  return 0
}

/** The versions a normal release may move to from `current`. */
export const nextVersions = (current) => {
  const c = typeof current === 'string' ? parse(current) : current
  return {
    patch: `${c.major}.${c.minor}.${c.patch + (c.prerelease.length ? 0 : 1)}`,
    minor: `${c.major}.${c.minor + 1}.0`,
    major: `${c.major + 1}.0.0`
  }
}

/**
 * Decides whether `requested` is a valid release after `current`.
 * Rules: valid SemVer; strictly greater; no skipped numbers (one step: patch,
 * minor with patch reset, or major with minor+patch reset — prereleases of
 * those allowed); not already tagged.
 */
export const validateRelease = (requested, current, existingTags = []) => {
  const next = parse(requested)
  if (!next) return { valid: false, reason: `"${requested}" is not a valid SemVer version (expected MAJOR.MINOR.PATCH, e.g. 1.4.0).` }
  const cur = parse(current)
  if (!cur) return { valid: false, reason: `The current version "${current}" in package.json is not valid SemVer.` }
  if (next.build) return { valid: false, reason: 'Release versions must not carry build metadata (+…).' }
  if (compare(next, cur) <= 0) return { valid: false, reason: `${next.raw} is not greater than the current version ${cur.raw}.` }
  const core = `${next.major}.${next.minor}.${next.patch}`
  const allowed = Object.values(nextVersions(cur))
  // Finishing or advancing a prerelease of the same core is also a legal step.
  const sameCore = cur.prerelease.length > 0 && core === `${cur.major}.${cur.minor}.${cur.patch}`
  if (!allowed.includes(core) && !sameCore) {
    const n = nextVersions(cur)
    return { valid: false, reason: `${next.raw} skips versions. From ${cur.raw} the next release is ${n.patch} (fix), ${n.minor} (feature) or ${n.major} (breaking).` }
  }
  if (existingTags.includes(`v${next.raw}`)) return { valid: false, reason: `v${next.raw} is already released (tag exists).` }
  const kind = next.major !== cur.major ? 'major' : next.minor !== cur.minor ? 'minor' : next.patch !== cur.patch ? 'patch' : 'prerelease'
  return { valid: true, version: next.raw, kind, prerelease: next.prerelease.length > 0 }
}

const BREAKING = /^[a-z]+(\([^)]*\))?!:/
const FEATURE = /^feat(\([^)]*\))?:/
/** Commit types that change nothing a user gets: they alone never call for a release. */
const NO_RELEASE = /^(docs|test|tests|ci|build|chore|style)(\([^)]*\))?:/

/**
 * The next version from the commits since the last release (Conventional Commits): a breaking change
 * is major (minor before 1.0, SemVer §4), a feature is minor, anything else that reaches users is a
 * patch. `commits` are `{ subject, body }`; release commits themselves are ignored.
 */
export const suggestRelease = (current, commits) => {
  const relevant = commits.filter((c) => !/^chore\(release\):/.test(c.subject))
  const breaking = relevant.filter((c) => BREAKING.test(c.subject) || /^BREAKING[ -]CHANGE:/m.test(c.body ?? ''))
  const features = relevant.filter((c) => FEATURE.test(c.subject))
  const userFacing = relevant.filter((c) => !NO_RELEASE.test(c.subject))
  if (!userFacing.length && !breaking.length) return { kind: 'none', reason: 'No user-facing commits since the last release.', commits: relevant }
  const next = nextVersions(current)
  const preOne = parse(current).major === 0
  const kind = breaking.length ? (preOne ? 'minor' : 'major') : features.length ? 'minor' : 'patch'
  const reason = breaking.length
    ? `${breaking.length} breaking change(s)${preOne ? ' (before 1.0 a breaking change is a minor step)' : ''}`
    : features.length
      ? `${features.length} feature(s)`
      : `${userFacing.length} fix(es) or other user-facing change(s), no features`
  return { kind, version: next[kind], reason, commits: relevant }
}
