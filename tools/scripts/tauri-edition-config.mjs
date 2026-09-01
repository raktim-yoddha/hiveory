import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const tauriDir = resolve(projectRoot, 'src', 'apps', 'desktop', 'src-tauri')
export const tauriConfigPath = resolve(tauriDir, 'tauri.conf.json')
export const tauriCli = resolve(projectRoot, 'node_modules', '@tauri-apps', 'cli', 'tauri.js')

export function createTauriEditionConfig({ edition, disableUpdater = false }) {
  const config = JSON.parse(readFileSync(tauriConfigPath, 'utf8'))

  if (edition === 'dev') {
    config.productName = 'Hiveory Dev'
    config.identifier = 'com.hiveory.dev'
    config.app = {
      ...config.app,
      windows: config.app.windows.map((window) => ({ ...window, title: 'Hiveory Dev' })),
    }
    config.bundle = {
      ...config.bundle,
      active: false,
      createUpdaterArtifacts: false,
    }
  } else if (edition !== 'production') {
    throw new Error(`Unsupported Hiveory edition: ${edition}`)
  }

  if (disableUpdater) {
    config.bundle = { ...config.bundle, createUpdaterArtifacts: false }
  }

  const path = resolve(tauriDir, `.tauri.${edition}.${process.pid}-${Date.now()}.json`)
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  return path
}

export function configArgument(configPath) {
  return basename(configPath)
}

export function removeTauriEditionConfig(configPath) {
  if (!configPath) return
  try {
    rmSync(configPath, { force: true })
  } catch (error) {
    console.error(`Temporary Tauri configuration could not be removed: ${configPath}`)
    console.error(error)
    process.exitCode = 1
  }
}
