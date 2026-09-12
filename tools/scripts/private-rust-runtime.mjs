import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { projectRoot } from './tauri-edition-config.mjs'

const privateRuntime = resolve(projectRoot, '..', 'hiveory-private', 'src', 'features', 'agent', 'rust', 'hiveory-agent-runtime')
const manifests = [
  resolve(projectRoot, 'src', 'apps', 'desktop', 'src-tauri', 'Cargo.toml'),
  resolve(projectRoot, 'src', 'crates', 'global', 'automations', 'hiveory-routine-scheduler', 'Cargo.toml'),
]
const workspaceManifest = resolve(projectRoot, 'Cargo.toml')

// Cargo has no way to select a sibling path dependency by edition. These
// changes exist only for the lifetime of a local Dev process; the committed
// manifests always point to the inert public receiver.
export function usePrivateRustRuntime() {
  if (!existsSync(resolve(privateRuntime, 'Cargo.toml'))) {
    throw new Error(`The local Dev build needs the private Agent repository at ${privateRuntime}`)
  }
  const path = privateRuntime.replaceAll('\\', '/')
  const originals = []
  try {
    const originalWorkspace = readFileSync(workspaceManifest, 'utf8')
    const nextWorkspace = originalWorkspace.replace(/^  "src\/crates\/modes\/agent\/hiveory-agent-runtime",\r?\n/m, '')
    if (nextWorkspace === originalWorkspace) throw new Error('The public Agent receiver is missing from the Cargo workspace')
    originals.push({ manifest: workspaceManifest, original: originalWorkspace, next: nextWorkspace })
    writeFileSync(workspaceManifest, nextWorkspace)
    for (const manifest of manifests) {
      const original = readFileSync(manifest, 'utf8')
      const next = original.replace(/^(hiveory-agent-runtime\s*=\s*\{\s*path\s*=\s*)"[^"]+"(\s*\})/m, `$1"${path}"$2`)
      if (next === original) throw new Error(`Agent runtime dependency was not found in ${manifest}`)
      originals.push({ manifest, original, next })
      writeFileSync(manifest, next)
    }
  } catch (error) {
    for (const { manifest, original } of originals) writeFileSync(manifest, original)
    throw error
  }
  let restored = false
  return () => {
    if (restored) return
    restored = true
    for (const { manifest, original, next } of originals) {
      if (readFileSync(manifest, 'utf8') !== next) {
        throw new Error(`Refusing to overwrite an edited Cargo manifest: ${manifest}`)
      }
      writeFileSync(manifest, original)
    }
  }
}
