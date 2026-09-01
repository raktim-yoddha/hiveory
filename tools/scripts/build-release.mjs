import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const releaseDir = resolve(projectRoot, 'releases')
const tauriConfig = resolve(projectRoot, 'src', 'apps', 'desktop', 'src-tauri', 'tauri.conf.json')
const tauriCommand = resolve(projectRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tauri.cmd' : 'tauri')
const buildDir = mkdtempSync(join(tmpdir(), 'hiveory-build-'))
const signingKey = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim()
const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
let temporaryConfigPath = null

function resolveBuildConfig() {
  if (signingKey) return tauriConfig
  if (isCi) {
    throw new Error('TAURI_SIGNING_PRIVATE_KEY is required for CI release builds. Configure the paired private key as a secret.')
  }

  const config = JSON.parse(readFileSync(tauriConfig, 'utf8'))
  config.bundle = { ...(config.bundle ?? {}), createUpdaterArtifacts: false }
  temporaryConfigPath = join(dirname(tauriConfig), `.tauri.conf.local-${process.pid}-${Date.now()}.json`)
  writeFileSync(temporaryConfigPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  console.warn('TAURI_SIGNING_PRIVATE_KEY is not set; building unsigned installers without updater artifacts. Set it to produce signed updater artifacts.')
  return temporaryConfigPath
}

function requiredFile(path, description) {
  if (!existsSync(path)) throw new Error(`${description} was not produced: ${path}`)
  return path
}

function findArtifact(directory, suffix, description) {
  const artifact = readdirSync(directory).find((name) => name.toLowerCase().endsWith(suffix))
  if (!artifact) throw new Error(`${description} was not produced in ${directory}`)
  return resolve(directory, artifact)
}

try {
  console.log('Building the desktop application in a temporary directory outside the project …')
  const configPath = resolveBuildConfig()
  const configArgument = configPath === tauriConfig ? 'tauri.conf.json' : basename(configPath)
  const result = spawnSync(tauriCommand, ['build', '--config', configArgument], {
    cwd: dirname(tauriConfig),
    env: { ...process.env, CARGO_TARGET_DIR: buildDir },
    shell: process.platform === 'win32',
    stdio: 'inherit',
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    throw new Error(`Desktop build failed with exit code ${result.status ?? 1}`)
  }

  const sourceExe = requiredFile(resolve(buildDir, 'release', 'hiveory-desktop.exe'), 'Portable executable')
  const msi = findArtifact(resolve(buildDir, 'release', 'bundle', 'msi'), '.msi', 'MSI installer')
  const setup = findArtifact(resolve(buildDir, 'release', 'bundle', 'nsis'), '-setup.exe', 'NSIS installer')

  mkdirSync(releaseDir, { recursive: true })
  const published = [
    ['Hiveory.msi', msi],
    ['Hiveory-setup.exe', setup],
    ['Hiveory-portable.exe', sourceExe],
  ]
  const publishedNames = new Set(published.map(([name]) => name))

  for (const entry of readdirSync(releaseDir, { withFileTypes: true })) {
    if (!publishedNames.has(entry.name)) {
      rmSync(resolve(releaseDir, entry.name), { force: true, recursive: entry.isDirectory() })
    }
  }

  const failures = []
  const completed = []
  for (const [name, source] of published) {
    const destination = resolve(releaseDir, name)
    try {
      if (existsSync(destination)) rmSync(destination, { force: true })
      copyFileSync(source, destination)
      completed.push(name)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      if (code === 'EPERM' || code === 'EBUSY') {
        failures.push(`${name} is in use; close the running application and rerun pnpm app:build`)
        continue
      }
      throw error
    }
  }

  if (completed.length) {
    console.log('The single releases/ folder was updated:')
    for (const name of completed) console.log(`  releases/${name}`)
  }
  if (failures.length) {
    console.error('Some release artifacts could not be replaced:')
    for (const failure of failures) console.error(`  ${failure}`)
    process.exitCode = 1
  }
} finally {
  if (temporaryConfigPath) {
    try {
      rmSync(temporaryConfigPath, { force: true })
    } catch (error) {
      console.error(`Temporary Tauri configuration could not be removed: ${temporaryConfigPath}`)
      console.error(error)
      process.exitCode = 1
    }
  }
  try {
    rmSync(buildDir, { force: true, recursive: true })
  } catch (error) {
    console.error(`Temporary build directory could not be removed: ${buildDir}`)
    console.error(error)
    process.exitCode = 1
  }
}
