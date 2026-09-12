import { spawnSync } from 'node:child_process'
import { usePrivateRustRuntime } from './private-rust-runtime.mjs'
import { projectRoot } from './tauri-edition-config.mjs'

const restore = usePrivateRustRuntime()
try {
  const result = spawnSync(process.platform === 'win32' ? 'cargo.exe' : 'cargo', ['check', '-p', 'hiveory-app-host', '--offline'], {
    cwd: projectRoot,
    env: { ...process.env, HIVEORY_EDITION: 'dev', CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || 'target/codex-check' },
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exitCode = result.status ?? 1
} finally {
  restore()
}
