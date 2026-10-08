// Release Hiveory: node scripts/release.mjs <version> [--check]
// Validates the version against SemVer + project rules (scripts/semver.mjs) and that CHANGELOG.md has an
// "## Unreleased — Title" entry with highlights. With --check it stops there. Otherwise it stamps that entry
// with the version and date, bumps the desktop and phone versions, commits, tags vX.Y.Z and pushes. The
// tag starts .github/workflows/release.yml, which builds every installer and publishes the GitHub release
// (which the in-app updaters read).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { parse, validateRelease } from './semver.mjs'

const [requested, flag] = process.argv.slice(2)
const checkOnly = flag === '--check'
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
const fail = (message) => {
  console.error(`✗ Not released: ${message}`)
  process.exit(1)
}

if (!requested) fail('usage: pnpm release <version> [--check]')
const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
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
if (run('git', ['status', '--porcelain'])) fail('the working tree has uncommitted changes. Commit or stash them first.')

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
