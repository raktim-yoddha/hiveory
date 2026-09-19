import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..')
const args = process.argv.slice(2)
const command = args.shift()

function option(name, fallback = undefined) {
  const index = args.indexOf(`--${name}`)
  return index === -1 ? fallback : args[index + 1] ?? fallback
}

function requireVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value ?? '')) throw new Error(`Expected X.Y.Z version, received ${value ?? '<missing>'}`)
  return value
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(resolve(root, relativePath), 'utf8'))
}

function currentVersion() {
  return readJson('package.json').version
}

function nextPatchVersion(version = currentVersion()) {
  const [major, minor, patch] = requireVersion(version).split('.').map(Number)
  return `${major}.${minor}.${patch + 1}`
}

function replaceOnce(relativePath, pattern, replacement, description) {
  const path = resolve(root, relativePath)
  const source = readFileSync(path, 'utf8')
  const updated = source.replace(pattern, replacement)
  if (updated === source) throw new Error(`Could not update ${description} in ${relativePath}`)
  writeFileSync(path, updated, 'utf8')
}

function syncVersion(version) {
  const old = currentVersion()
  replaceOnce('package.json', /("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${version}$2`, 'root package version')
  replaceOnce('src/apps/renderer/package.json', /("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${version}$2`, 'renderer package version')
  replaceOnce('src/apps/desktop/src-tauri/tauri.conf.json', /("version"\s*:\s*")\d+\.\d+\.\d+(")/, `$1${version}$2`, 'Tauri version')
  replaceOnce('Cargo.toml', /(\[workspace\.package\][\s\S]*?\nversion\s*=\s*")\d+\.\d+\.\d+(")/, `$1${version}$2`, 'Cargo workspace version')

  const lockPath = resolve(root, 'Cargo.lock')
  if (existsSync(lockPath)) {
    const lock = readFileSync(lockPath, 'utf8')
    const updated = lock.replace(/(\[\[package\]\][\s\S]*?name = "hiveory-[^"]+"[\s\S]*?version = ")\d+\.\d+\.\d+(")/g, `$1${version}$2`)
    writeFileSync(lockPath, updated, 'utf8')
  }
  for (const relativePath of [
    'README.md',
    'docs/README.md',
    'docs/security/threat-model.md',
    'docs/architecture/README.md',
    'docs/architecture/hiveory-foundation.md',
    'docs/architecture/release-and-recovery.md',
  ]) {
    const path = resolve(root, relativePath)
    const source = readFileSync(path, 'utf8')
    writeFileSync(path, source.replaceAll(`\`${old}\``, `\`${version}\``), 'utf8')
  }
  console.log(`Synchronized Hiveory version ${old} -> ${version}`)
}

function changelogSection(version) {
  const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')
  const heading = new RegExp(`^## ${version.replaceAll('.', '\\.')}(?:[^\\n]*)\\n`, 'm')
  const match = heading.exec(changelog)
  if (!match) throw new Error(`CHANGELOG.md has no section for ${version}`)
  const body = changelog.slice(match.index + match[0].length)
  const nextHeading = body.search(/^## \d+\.\d+\.\d+/m)
  return body.slice(0, nextHeading === -1 ? body.length : nextHeading).trim()
}

function previousVersion(version) {
  const changelog = readFileSync(resolve(root, 'CHANGELOG.md'), 'utf8')
  const versions = [...changelog.matchAll(/^## (\d+\.\d+\.\d+)/gm)].map((match) => match[1])
  const index = versions.indexOf(version)
  return index >= 0 ? versions[index + 1] : undefined
}

function previousTag(version) {
  const previous = previousVersion(version)
  if (!previous) return undefined
  for (const candidate of [`v${previous}`, previous]) {
    try {
      execFileSync('git', ['rev-parse', '--verify', `refs/tags/${candidate}`], { cwd: root, stdio: 'ignore' })
      return candidate
    } catch {
      // Try the legacy unprefixed tag before falling back to the standard form.
    }
  }
  return `v${previous}`
}

function bullets(section) {
  return section.split('\n').filter((line) => /^\s*-\s+/.test(line)).map((line) => line.replace(/^\s*-\s+/, '').trim())
}

function notes(version) {
  const section = changelogSection(version)
  const lines = section.split('\n')
  const categories = { Added: [], Changed: [], Fixed: [], Security: [] }
  let category = 'Changed'
  for (const line of lines) {
    const heading = line.match(/^###\s+(.+)$/)
    if (heading) {
      const normalized = Object.keys(categories).find((key) => key.toLowerCase() === heading[1].trim().toLowerCase())
      category = normalized ?? 'Changed'
      continue
    }
    const bullet = line.match(/^\s*-\s+(.+)$/)
    if (bullet) categories[category].push(bullet[1].trim())
  }
  const allBullets = bullets(section)
  const highlights = allBullets.slice(0, 3)
  const summary = highlights[0] ?? `Hiveory ${version} is available for Windows x64.`
  const previous = previousTag(version)
  const compare = previous
    ? `https://github.com/raktim-yoddha/hiveory/compare/${previous}...v${version}`
    : `https://github.com/raktim-yoddha/hiveory/releases/tag/v${version}`
  const output = [
    summary,
    '',
    '## Highlights',
    ...highlights.map((item) => `- ${item}`),
    '',
    '## Changes',
  ]
  for (const [name, entries] of Object.entries(categories)) {
    if (entries.length === 0) continue
    output.push('', `### ${name}`, ...entries.map((entry) => `- ${entry}`))
  }
  output.push('', '## Windows downloads', '', '- `Hiveory-portable.exe` - standalone portable executable.', '- `Hiveory-setup.exe` - signed NSIS installer.', '- `Hiveory.msi` - Windows Installer package.', '', '## Auto-update', '', 'The signed Windows x64 NSIS bundle and `latest.json` updater manifest are published with this release.', '', '## Verification', '', '- Release checks completed before tagging.', '- Windows installers and updater signatures uploaded.', '- `latest.json` version, signature, and installer URL verified.', '', `[Full changelog comparison](${compare})`)
  return output.join('\n')
}

function validate(version, tag) {
  requireVersion(version)
  const versions = [currentVersion(), readJson('src/apps/renderer/package.json').version, readJson('src/apps/desktop/src-tauri/tauri.conf.json').version]
  const cargo = readFileSync(resolve(root, 'Cargo.toml'), 'utf8').match(/\[workspace\.package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1]
  versions.push(cargo)
  if (versions.some((value) => value !== version)) throw new Error(`Version mismatch: ${versions.join(', ')}`)
  const lock = readFileSync(resolve(root, 'Cargo.lock'), 'utf8')
  for (const block of lock.split('\n[[package]]').slice(1)) {
    const name = block.match(/^\n?name = "([^"]+)"/)?.[1]
    const lockVersion = block.match(/^version = "([^"]+)"/m)?.[1]
    const isWorkspacePackage = name?.startsWith('hiveory-') && !/^source = /m.test(block)
    if (isWorkspacePackage && lockVersion !== version) throw new Error(`Cargo.lock version is stale for ${name}: ${lockVersion}`)
  }
  for (const relativePath of ['README.md', 'docs/README.md', 'docs/security/threat-model.md', 'docs/architecture/README.md', 'docs/architecture/hiveory-foundation.md', 'docs/architecture/release-and-recovery.md']) {
    const source = readFileSync(resolve(root, relativePath), 'utf8')
    if (!source.includes(`\`${version}\``)) throw new Error(`Document version is stale: ${relativePath}`)
  }
  changelogSection(version)
  if (tag && tag !== `v${version}` && !(version === '0.2.2' && tag === '0.2.2')) throw new Error(`Tag must be v${version}`)
  console.log(`Validated Hiveory ${version}${tag ? ` (${tag})` : ''}`)
}

async function verifyRelease(tag) {
  if (!/^v?\d+\.\d+\.\d+$/.test(tag)) throw new Error(`Invalid release tag: ${tag}`)
  const version = tag.replace(/^v/, '')
  const repository = option('repository', 'raktim-yoddha/hiveory')
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'hiveory-release-verifier' }
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const releaseResponse = await fetch(`https://api.github.com/repos/${repository}/releases/tags/${tag}`, { headers })
  if (!releaseResponse.ok) throw new Error(`GitHub release lookup failed: HTTP ${releaseResponse.status}`)
  const release = await releaseResponse.json()
  if (release.draft || release.prerelease) throw new Error('Release is draft or prerelease')
  const latestResponse = await fetch(`https://api.github.com/repos/${repository}/releases/latest`, { headers })
  if (!latestResponse.ok) throw new Error(`Latest release lookup failed: HTTP ${latestResponse.status}`)
  const latest = await latestResponse.json()
  if (latest.tag_name !== tag) throw new Error(`Release ${tag} is not marked as the latest stable release`)
  const expectedSha = option('expected-sha')
  if (expectedSha) {
    const refResponse = await fetch(`https://api.github.com/repos/${repository}/git/ref/tags/${tag}`, { headers })
    if (!refResponse.ok) throw new Error(`Tag lookup failed: HTTP ${refResponse.status}`)
    const ref = await refResponse.json()
    const actualSha = ref.object?.type === 'tag' ? (await (await fetch(ref.object.url, { headers })).json()).object?.sha : ref.object?.sha
    if (actualSha !== expectedSha) throw new Error(`Tag ${tag} points to ${actualSha}, expected ${expectedSha}`)
  }
  const names = release.assets.map((asset) => asset.name)
  for (const required of ['Hiveory-portable.exe', 'Hiveory-setup.exe', 'Hiveory.msi', 'Hiveory-setup.exe.sig', 'Hiveory.msi.sig', 'latest.json']) {
    if (!names.includes(required)) throw new Error(`Missing release asset: ${required}`)
  }
  if (names.some((name) => /\.(dmg|appimage|deb|rpm|app\.tar\.gz|pkg)$/i.test(name))) throw new Error('Release contains a macOS or Linux asset')
  const manifestResponse = await fetch(`https://github.com/${repository}/releases/download/${tag}/latest.json`, { headers: { 'User-Agent': headers['User-Agent'] } })
  if (!manifestResponse.ok) throw new Error(`Updater manifest lookup failed: HTTP ${manifestResponse.status}`)
  const manifest = await manifestResponse.json()
  const latestManifestResponse = await fetch(`https://github.com/${repository}/releases/latest/download/latest.json`, { headers: { 'User-Agent': headers['User-Agent'] } })
  if (!latestManifestResponse.ok) throw new Error(`Latest updater endpoint failed: HTTP ${latestManifestResponse.status}`)
  const latestManifest = await latestManifestResponse.json()
  const platform = manifest.platforms?.['windows-x86_64']
  const latestPlatform = latestManifest.platforms?.['windows-x86_64']
  if (manifest.version !== version || latestManifest.version !== version || !platform?.signature || !platform.url || !latestPlatform?.signature || !latestPlatform.url || !/Hiveory-setup\.exe(?:\?|$)/.test(platform.url) || !/Hiveory-setup\.exe(?:\?|$)/.test(latestPlatform.url)) throw new Error('latest.json has no valid Windows x64 signed NSIS entry')
  console.log(`Verified ${tag}: release assets, latest.json, signature, and Windows x64 URL`)
}

try {
  if (command === 'sync-version') syncVersion(requireVersion(option('version')))
  else if (command === 'next-version') console.log(nextPatchVersion(option('version', currentVersion())))
  else if (command === 'validate') validate(option('version', currentVersion()), option('tag'))
  else if (command === 'notes') process.stdout.write(`${notes(requireVersion(option('version', currentVersion())))}\n`)
  else if (command === 'verify-release') await verifyRelease(option('tag'))
  else throw new Error('Usage: sync-version|validate|notes|verify-release')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
