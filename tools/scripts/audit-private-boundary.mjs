import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { projectRoot } from './tauri-edition-config.mjs'

const read = (path) => readFileSync(resolve(projectRoot, path), 'utf8')
const host = read('src/apps/desktop/src-tauri/Cargo.toml')
const scheduler = read('src/crates/global/automations/hiveory-routine-scheduler/Cargo.toml')
const runtime = read('src/crates/modes/agent/hiveory-agent-runtime/src/lib.rs')
const workspace = read('Cargo.toml')
const renderer = read('src/apps/renderer/vite.config.ts')

for (const [name, source] of [['host manifest', host], ['scheduler manifest', scheduler], ['workspace manifest', workspace]]) {
  if (source.includes('hiveory-private')) throw new Error(`Private source path leaked into the ${name}`)
}
if (!workspace.includes('"src/crates/modes/agent/hiveory-agent-runtime"')) throw new Error('Public Agent receiver is missing from the workspace')
if (!runtime.includes('Public Agent receiver.') || runtime.includes('async fn execute_run(')) {
  throw new Error('Agent execution code is present in the public receiver')
}
if (!renderer.includes("devEdition ? privateFeatures")) throw new Error('Renderer edition boundary is missing')

const result = spawnSync('git', ['ls-files', '--cached', '-z'], { cwd: projectRoot, encoding: 'utf8' })
if (result.error || result.status !== 0) throw result.error ?? new Error('Could not inspect the Git index')
for (const file of result.stdout.split('\0').filter(Boolean)) {
  if (/^(?:releases\/|.*\.(?:exe|msi|msix|dmg|app|pfx|pem|key)$)/i.test(file)) {
    throw new Error(`Build output or key is staged for the public repository: ${file}`)
  }
}
console.log('Public/private source and artifact boundary verified.')
