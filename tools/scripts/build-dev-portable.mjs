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
  try {
    copyFileSync(source, destination)
  } catch (error) {
    if (error?.code === 'EPERM' || error?.code === 'EBUSY') {
      throw new Error('Hiveory Dev portable is in use. Close releases/dev/Hiveory-Dev-portable.exe and rerun pnpm app:build:dev.')
    }
    throw error
  }
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
