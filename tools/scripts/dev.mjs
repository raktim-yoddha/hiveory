import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const tauriDir = resolve(projectRoot, 'src', 'apps', 'desktop', 'src-tauri')
const tauriCommand = resolve(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tauri.cmd' : 'tauri',
)

const child = spawn(tauriCommand, ['dev'], {
  cwd: tauriDir,
  env: { ...process.env, INIT_CWD: tauriDir },
  shell: process.platform === 'win32',
  windowsHide: process.platform === 'win32',
  stdio: 'inherit',
})

child.on('error', (error) => {
  console.error(`Unable to start the desktop development host: ${error.message}`)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})
