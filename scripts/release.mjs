// Release Hiveory: node scripts/release.mjs <version> [--check]
// Validates the version against SemVer + project rules (scripts/semver.mjs). With --check it stops
// there. Otherwise it bumps package.json, commits, tags vX.Y.Z, pushes, builds the installer for this
// platform and publishes it to GitHub Releases (which the in-app updater reads).
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { validateRelease } from './semver.mjs'

const [requested, flag] = process.argv.slice(2)
const checkOnly = flag === '--check'
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).trim()
const shell = process.platform === 'win32'
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
console.log(`✓ ${verdict.version} is a valid ${verdict.kind} release after ${pkg.version}.`)
if (checkOnly) process.exit(0)

const branch = run('git', ['branch', '--show-current'])
if (branch !== 'main') fail(`releases are cut from main (you are on "${branch}").`)
if (run('git', ['status', '--porcelain'])) fail('the working tree has uncommitted changes. Commit or stash them first.')

pkg.version = verdict.version
writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`)
run('git', ['add', 'package.json'])
run('git', ['commit', '-m', `chore(release): v${verdict.version}`])
run('git', ['tag', '-a', `v${verdict.version}`, '-m', `Hiveory v${verdict.version}`])
run('git', ['push', 'origin', 'main', '--follow-tags'], { stdio: 'inherit' })

const token = run('gh', ['auth', 'token'])
execFileSync('pnpm', ['build'], { stdio: 'inherit', shell })
execFileSync('pnpm', ['exec', 'electron-builder', '--publish', 'always'], {
  stdio: 'inherit',
  shell,
  env: { ...process.env, GH_TOKEN: token }
})
console.log(`✓ Released v${verdict.version}: https://github.com/raktim-yoddha/hiveory/releases/tag/v${verdict.version}`)
