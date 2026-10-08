// Release Hiveory (AGENTS.md §26):
//   pnpm release next               the next SemVer version from the commits since the last release, and why
//   pnpm release <version> --check  validate it and the CHANGELOG.md "## Unreleased — Title" entry
//   pnpm release <version>          stamp that entry, bump the desktop and phone versions, commit, tag vX.Y.Z, push
// The tag starts .github/workflows/release.yml, which builds every installer and publishes the GitHub release
// (which the in-app updaters read).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { parse, suggestRelease, validateRelease } from './semver.mjs'

const [requested, flag] = process.argv.slice(2)
const checkOnly = flag === '--check'
const run = (cmd, args, opts = {}) => (execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }) ?? '').trim()
const fail = (message) => {
  console.error(`✗ Not released: ${message}`)
  process.exit(1)
}

if (!requested) fail('usage: pnpm release next | pnpm release <version> [--check]')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))

if (requested === 'next') {
  const last = `v${pkg.version}`
  const range = run('git', ['tag', '--list', last]) ? `${last}..HEAD` : 'HEAD'
  const SEP = '\u001e'
  const commits = run('git', ['log', `--format=%h %s%n%b${SEP}`, range])
    .split(SEP)
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => {
      const [first, ...body] = c.split(/\r?\n/)
      return { sha: first.slice(0, first.indexOf(' ')), subject: first.slice(first.indexOf(' ') + 1), body: body.join('\n') }
    })
  const s = suggestRelease(pkg.version, commits)
  if (s.kind === 'none') {
    console.log(`Nothing to release since ${last}: ${s.reason}`)
    process.exit(0)
  }
  console.log(`Next: ${s.version} (${s.kind}) after ${pkg.version} — ${s.reason}.`)
  console.log(`Commits since ${last}:`)
  for (const c of s.commits.slice().reverse()) console.log(`  ${c.sha} ${c.subject}`)
  process.exit(0)
}
const localTags = run('git', ['tag', '--list', 'v*']).split(/\r?\n/).filter(Boolean)
let remoteTags = []
try {
  remoteTags = run('git', ['ls-remote', '--tags', 'origin'])
    .split(/\r?\n/)
    .map((l) => l.split('refs/tags/')[1]?.replace(/\^\{\}$/, ''))
    .filter(Boolean)
} catch {
  // Offline: local tags still guard against duplicates.
}

const verdict = validateRelease(requested, pkg.version, [...new Set([...localTags, ...remoteTags])])
if (!verdict.valid) fail(verdict.reason)

const changelog = readFileSync('CHANGELOG.md', 'utf8')
const unreleased = /^## Unreleased — (.+)\r?\n((?:- .+\r?\n?)+)/m.exec(changelog)
if (!unreleased) fail('CHANGELOG.md needs an "## Unreleased — Title" entry with "- " highlight lines for this release.')
console.log(`✓ ${verdict.version} is a valid ${verdict.kind} release after ${pkg.version}: "${unreleased[1]}".`)
if (checkOnly) process.exit(0)

const branch = run('git', ['branch', '--show-current'])
if (branch !== 'main') fail(`releases are cut from main (you are on "${branch}").`)
// The release notes just written into CHANGELOG.md go into the release commit; anything else must not.
const dirty = run('git', ['status', '--porcelain']).split(/\r?\n/).filter((l) => l && !/ CHANGELOG\.md$/.test(l))
if (dirty.length) fail(`the working tree has other uncommitted changes (${dirty.length}). Commit or stash them first.`)

/** Android's versionCode must always grow: MAJOR MINOR PATCH, then 99 for a release or the prerelease number. */
const androidVersionCode = (version) => {
  const v = parse(version)
  const pre = v.prerelease.length ? Number(v.prerelease.at(-1)) || 0 : 99
  return ((v.major * 100 + v.minor) * 100 + v.patch) * 100 + pre
}

const today = new Date().toISOString().slice(0, 10)
const version = verdict.version
writeFileSync('CHANGELOG.md', changelog.replace(/^## Unreleased — (.+)$/m, `## v${version} — $1\n_${today}_\n`))
pkg.version = version
writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
const phonePkg = JSON.parse(readFileSync('mobile/package.json', 'utf8'))
phonePkg.version = version
writeFileSync('mobile/package.json', `${JSON.stringify(phonePkg, null, 2)}\n`)
// app.json keeps its hand formatting: only the two version fields change.
const appJson = readFileSync('mobile/app.json', 'utf8')
  .replace(/("version":\s*)"[^"]*"/, `$1"${version}"`)
  .replace(/("versionCode":\s*)\d+/, `$1${androidVersionCode(version)}`)
if (!appJson.includes(`"versionCode": ${androidVersionCode(version)}`)) fail('mobile/app.json needs an "android.versionCode" field.')
writeFileSync('mobile/app.json', appJson)

run('git', ['add', 'CHANGELOG.md', 'package.json', 'mobile/package.json', 'mobile/app.json'])
run('git', ['commit', '-m', `chore(release): v${version}`])
run('git', ['tag', '-a', `v${version}`, '-m', `Hiveory v${version} — ${unreleased[1]}`])
run('git', ['push', 'origin', 'main', `refs/tags/v${version}`], { stdio: 'inherit' })
console.log(`✓ Tagged v${version}. GitHub Actions is building the installers: https://github.com/raktim-yoddha/hiveory/actions`)
console.log(`  The release appears when every build passes: https://github.com/raktim-yoddha/hiveory/releases/tag/v${version}`)
