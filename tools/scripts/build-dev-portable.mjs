import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
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

const buildDir = mkdtempSync(join(tmpdir(), 'hiveory-dev-build-'))
const releaseDir = resolve(projectRoot, 'releases', 'dev')
let temporaryConfigPath = null

function stopRunningDevPortable(executablePath) {
  if (process.platform !== 'win32') return

  const script = `
    $target = [System.IO.Path]::GetFullPath($env:HIVEORY_DEV_PORTABLE_PATH)
    Get-CimInstance Win32_Process -Filter "Name = 'Hiveory-Dev-portable.exe'" |
      Where-Object { $_.ExecutablePath -and [System.IO.Path]::GetFullPath($_.ExecutablePath) -ieq $target } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop; Write-Output $_.ProcessId }
  `
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    cwd: projectRoot,
    env: { ...process.env, HIVEORY_DEV_PORTABLE_PATH: executablePath },
    windowsHide: true,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Unable to close the running Hiveory Dev portable: ${result.stderr.trim() || `exit code ${result.status}`}`)
  const processIds = result.stdout.trim().split(/\s+/).filter(Boolean)
  if (processIds.length > 0) console.log(`Closed running Hiveory Dev portable process${processIds.length === 1 ? '' : 'es'}: ${processIds.join(', ')}`)
}

function waitForReplacement(source, destination) {
  let lastError = null
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      copyFileSync(source, destination)
      return
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EBUSY') throw error
      lastError = error
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150)
    }
  }
  throw new Error(`Hiveory Dev portable could not be replaced after closing it: ${lastError?.message ?? 'Windows kept the executable locked.'}`)
}

try {
  console.log('Building the Hiveory Dev portable executable …')
  temporaryConfigPath = createTauriEditionConfig({ edition: 'dev', disableUpdater: true })
  const result = spawnSync(process.execPath, [tauriCli, 'build', '--no-bundle', '--config', configArgument(temporaryConfigPath)], {
    cwd: tauriDir,
    env: {
      ...process.env,
      CARGO_TARGET_DIR: buildDir,
      VITE_HIVEORY_EDITION: 'dev',
    },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Hiveory Dev build failed with exit code ${result.status ?? 1}`)

  const source = resolve(buildDir, 'release', 'hiveory-desktop.exe')
  if (!existsSync(source)) throw new Error(`Hiveory Dev portable executable was not produced: ${source}`)

  mkdirSync(releaseDir, { recursive: true })
  const destination = resolve(releaseDir, 'Hiveory-Dev-portable.exe')
  stopRunningDevPortable(destination)
  waitForReplacement(source, destination)
  console.log('Hiveory Dev portable executable created:')
  console.log('  releases/dev/Hiveory-Dev-portable.exe')
} finally {
  removeTauriEditionConfig(temporaryConfigPath)
  try {
    rmSync(buildDir, { force: true, recursive: true })
  } catch (error) {
    console.error(`Temporary Hiveory Dev build directory could not be removed: ${buildDir}`)
    console.error(error)
    process.exitCode = 1
  }
}
