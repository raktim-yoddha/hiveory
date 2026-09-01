import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const releaseDir = resolve(projectRoot, 'releases')
const tauriConfig = resolve(projectRoot, 'src', 'apps', 'desktop', 'src-tauri', 'tauri.conf.json')
const tauriCli = resolve(projectRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')
const buildDir = mkdtempSync(join(tmpdir(), 'hiveory-build-'))
const appVersion = JSON.parse(readFileSync(resolve(projectRoot, 'package.json'), 'utf8')).version
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

function errorCode(error) {
  return error && typeof error === 'object' && 'code' in error ? error.code : undefined
}

function isLockedFileError(error) {
  return errorCode(error) === 'EPERM' || errorCode(error) === 'EBUSY'
}

function portableFallbackName() {
  return `Hiveory-portable-v${appVersion}-${Date.now()}.exe`
}

function replaceArtifact(name, source) {
  const destination = resolve(releaseDir, name)
  if (existsSync(destination)) rmSync(destination, { force: true })
  copyFileSync(source, destination)
  return name
}

try {
  console.log('Building the desktop application in a temporary directory outside the project …')
  const configPath = resolveBuildConfig()
  const configArgument = configPath === tauriConfig ? 'tauri.conf.json' : basename(configPath)
  const result = spawnSync(process.execPath, [tauriCli, 'build', '--config', configArgument], {
    cwd: dirname(tauriConfig),
    env: { ...process.env, CARGO_TARGET_DIR: buildDir },
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
  ]
  const publishedNames = new Set(published.map(([name]) => name))

  for (const entry of readdirSync(releaseDir, { withFileTypes: true })) {
    if (entry.name === 'Hiveory-portable.exe' || entry.name.startsWith('Hiveory-portable-v')) {
      continue
    }
    if (!publishedNames.has(entry.name)) {
      rmSync(resolve(releaseDir, entry.name), { force: true, recursive: entry.isDirectory() })
    }
  }

  const completed = []
  for (const [name, source] of published) {
    completed.push(replaceArtifact(name, source))
  }

  try {
    completed.push(replaceArtifact('Hiveory-portable.exe', sourceExe))
  } catch (error) {
    if (!isLockedFileError(error)) throw error
    const fallback = portableFallbackName()
    completed.push(replaceArtifact(fallback, sourceExe))
    console.warn(`Hiveory-portable.exe is in use; published the latest portable build as releases/${fallback}.`)
  }

  if (completed.length) {
    console.log('The single releases/ folder was updated:')
    for (const name of completed) console.log(`  releases/${name}`)
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
