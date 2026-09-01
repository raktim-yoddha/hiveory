import { spawn } from 'node:child_process'
import {
  configArgument,
  createTauriEditionConfig,
  removeTauriEditionConfig,
  tauriCli,
  tauriDir,
} from './tauri-edition-config.mjs'

const temporaryConfigPath = createTauriEditionConfig({ edition: 'dev', disableUpdater: true })
let cleanedUp = false

function cleanup() {
  if (cleanedUp) return
  cleanedUp = true
  removeTauriEditionConfig(temporaryConfigPath)
}

const child = spawn(process.execPath, [tauriCli, 'dev', '--config', configArgument(temporaryConfigPath)], {
  cwd: tauriDir,
  env: { ...process.env, INIT_CWD: tauriDir, VITE_HIVEORY_EDITION: 'dev' },
  windowsHide: process.platform === 'win32',
  stdio: 'inherit',
})

child.on('error', (error) => {
  cleanup()
  console.error(`Unable to start the desktop development host: ${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  cleanup()
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})
