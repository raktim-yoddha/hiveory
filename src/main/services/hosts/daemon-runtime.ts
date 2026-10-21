import { randomBytes } from 'node:crypto'
import type * as Fs from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'

/**
 * Electron's own fs reads app.asar as a folder; the copy must carry the archive itself, so it
 * uses `original-fs` (plain Node fs) inside Electron, and node:fs elsewhere (tests).
 */
const fs: typeof Fs = (() => {
  const require = createRequire(import.meta.url)
  try {
    return require('original-fs') as typeof Fs
  } catch {
    return require('node:fs') as typeof Fs
  }
})()

/** Where a daemon runs from: its executable (in Node mode) and hiveoryd's entry. */
export interface DaemonRuntime {
  exe: string
  entry: string
}

const MANIFEST = 'hiveory-runtime.json'

/** The installed app's folder: the .app bundle on macOS, the executable's folder elsewhere. */
export const appRoot = (execPath: string, platform: NodeJS.Platform = process.platform): string =>
  platform === 'darwin' ? resolve(execPath, '..', '..', '..') : dirname(execPath)

const files = (root: string, dir = root, out: Record<string, number> = {}): Record<string, number> => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) files(root, path, out)
    else if (entry.isFile()) out[relative(root, path).split(sep).join('/')] = fs.statSync(path).size
  }
  return out
}

/** Whether `dest` holds a complete copy: every file its manifest names, at its size. */
const complete = (dest: string): boolean => {
  try {
    const manifest = JSON.parse(fs.readFileSync(join(dest, MANIFEST), 'utf8')) as { files: Record<string, number> }
    return Object.entries(manifest.files).every(([path, size]) => fs.statSync(join(dest, path)).size === size)
  } catch {
    return false
  }
}

/**
 * The daemon's own copy of the app for this version (ADR 0050 §8), made once: the installer, the
 * macOS updater and an AppImage unmount replace or remove the installed files, never this copy, so
 * a running daemon outlives every update. A copy is built beside its final name and renamed into
 * place whole; one that fails its manifest is built again. Null when the entry is not inside the app.
 */
export const stageRuntime = async (
  dir: string,
  version: string,
  execPath: string,
  entry: string,
  platform: NodeJS.Platform = process.platform
): Promise<DaemonRuntime | null> => {
  const root = appRoot(execPath, platform)
  const exe = relative(root, execPath)
  const script = relative(root, entry)
  if (exe.startsWith('..') || script.startsWith('..')) return null
  const dest = join(dir, 'runtime', version)
  if (!complete(dest)) {
    const part = `${dest}.part-${randomBytes(4).toString('hex')}`
    try {
      await fs.promises.cp(root, part, { recursive: true, force: true })
      fs.writeFileSync(join(part, MANIFEST), JSON.stringify({ version, files: files(part) }))
      fs.rmSync(dest, { recursive: true, force: true })
      fs.renameSync(part, dest)
    } finally {
      fs.rmSync(part, { recursive: true, force: true })
    }
  }
  return { exe: join(dest, exe), entry: join(dest, script) }
}

/**
 * Removes copies no daemon runs from any more. On Windows a running executable cannot be removed,
 * which keeps an older daemon's copy until it exits; `keep` names the versions to leave alone anyway.
 */
export const pruneRuntimes = (dir: string, keep: string[]): void => {
  const base = join(dir, 'runtime')
  let names: string[]
  try {
    names = fs.readdirSync(base)
  } catch {
    return
  }
  for (const name of names) {
    if (keep.includes(name) || name.includes('.part-')) continue
    try {
      fs.rmSync(join(base, name), { recursive: true, force: true })
    } catch {
      // In use: the next start tries again.
    }
  }
}

/** The runtime version a daemon runs from, read off its executable's path (null: not a staged copy). */
export const runtimeVersionOf = (dir: string, exe: string | undefined): string | null => {
  if (!exe) return null
  const rel = relative(join(dir, 'runtime'), exe)
  return rel.startsWith('..') ? null : (rel.split(/[\\/]/)[0] ?? null)
}
