import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import {
  configArgument,
  createTauriEditionConfig,
  projectRoot,
  removeTauriEditionConfig,
  tauriCli,
  tauriDir,
} from './tauri-edition-config.mjs'

const releaseDir = resolve(projectRoot, 'releases', 'production')
const buildDir = mkdtempSync(join(tmpdir(), 'hiveory-build-'))
const signingKey = process.env.TAURI_SIGNING_PRIVATE_KEY?.trim()
const isCi = process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true'
let temporaryConfigPath = null

function resolveBuildConfig() {
  if (!signingKey && isCi) {
    throw new Error('TAURI_SIGNING_PRIVATE_KEY is required for CI release builds. Configure the paired private key as a secret.')
  }
  if (!signingKey) {
    console.warn('TAURI_SIGNING_PRIVATE_KEY is not set; building unsigned installers without updater artifacts. Set it to produce signed updater artifacts.')
  }
  temporaryConfigPath = createTauriEditionConfig({
    edition: 'production',
    disableUpdater: !signingKey,
  })
  return temporaryConfigPath
}

function portableFallbackName() {
  return `Hiveory-portable-v${Date.now()}.exe`
}

function isLockedFileError(error) {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return code === 'EPERM' || code === 'EBUSY'
}

function replaceArtifact(name, source) {
  const destination = resolve(releaseDir, name)
  if (existsSync(destination)) rmSync(destination, { force: true })
  copyFileSync(source, destination)
  return name
}

function findArtifact(directory, suffix, description) {
  const artifact = readdirSync(directory).find((name) => name.toLowerCase().endsWith(suffix))
  if (!artifact) throw new Error(`${description} was not produced in ${directory}`)
  return resolve(directory, artifact)
}

function requiredFile(path, description) {
  if (!existsSync(path)) throw new Error(`${description} was not produced: ${path}`)
  return path
}

try {
  console.log('Building the production Hiveory application in a temporary directory outside the project …')
  const configPath = resolveBuildConfig()
  const result = spawnSync(process.execPath, [tauriCli, 'build', '--config', configArgument(configPath)], {
    cwd: tauriDir,
    env: { ...process.env, CARGO_TARGET_DIR: buildDir, VITE_HIVEORY_EDITION: 'production' },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Production desktop build failed with exit code ${result.status ?? 1}`)

  const sourceExe = requiredFile(resolve(buildDir, 'release', 'hiveory-desktop.exe'), 'Portable executable')
  const msi = findArtifact(resolve(buildDir, 'release', 'bundle', 'msi'), '.msi', 'MSI installer')
  const setup = findArtifact(resolve(buildDir, 'release', 'bundle', 'nsis'), '-setup.exe', 'NSIS installer')

  mkdirSync(releaseDir, { recursive: true })
  const completed = [
    replaceArtifact('Hiveory.msi', msi),
    replaceArtifact('Hiveory-setup.exe', setup),
  ]
  try {
    completed.push(replaceArtifact('Hiveory-portable.exe', sourceExe))
  } catch (error) {
    if (!isLockedFileError(error)) throw error
    const fallback = portableFallbackName()
    completed.push(replaceArtifact(fallback, sourceExe))
    console.warn(`Hiveory-portable.exe is in use; published the latest portable build as releases/production/${fallback}.`)
  }

  console.log('Production release artifacts updated:')
  for (const name of completed) console.log(`  releases/production/${name}`)
} finally {
  removeTauriEditionConfig(temporaryConfigPath)
  try {
    rmSync(buildDir, { force: true, recursive: true })
  } catch (error) {
    console.error(`Temporary production build directory could not be removed: ${buildDir}`)
    console.error(error)
    process.exitCode = 1
  }
}
