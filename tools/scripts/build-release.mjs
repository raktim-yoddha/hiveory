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

function replaceArtifact(name, source) {
  const destination = resolve(releaseDir, name)
  if (existsSync(destination)) rmSync(destination, { force: true })
  copyFileSync(source, destination)
  return name
}

function stopRunningProductionPortable(executablePath) {
  if (process.platform !== 'win32') return

  const script = `
    $target = [System.IO.Path]::GetFullPath($env:HIVEORY_PRODUCTION_PORTABLE_PATH)
    Get-CimInstance Win32_Process -Filter "Name = 'Hiveory-portable.exe'" |
      Where-Object { $_.ExecutablePath -and [System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $target } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Output $_.ProcessId }
  `
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    cwd: projectRoot,
    env: { ...process.env, HIVEORY_PRODUCTION_PORTABLE_PATH: executablePath },
    windowsHide: true,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Unable to close the running Hiveory production portable: ${result.stderr.trim() || `exit code ${result.status}`}`)
  const processIds = result.stdout.trim().split(/\s+/).filter(Boolean)
  if (processIds.length > 0) console.log(`Closed running Hiveory production portable process${processIds.length === 1 ? '' : 'es'}: ${processIds.join(', ')}`)
}

function replacePortableArtifact(source) {
  const destination = resolve(releaseDir, 'Hiveory-portable.exe')
  stopRunningProductionPortable(destination)
  let lastError = null
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      if (existsSync(destination)) rmSync(destination, { force: true })
      copyFileSync(source, destination)
      return 'Hiveory-portable.exe'
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EBUSY') throw error
      lastError = error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150)
    }
  }
  throw new Error(`Hiveory production portable could not be replaced after closing it: ${lastError?.message ?? 'Windows kept the executable locked.'}`)
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
  completed.push(replacePortableArtifact(sourceExe))

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
