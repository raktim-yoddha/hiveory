import { existsSync, realpathSync, watch, type FSWatcher } from 'node:fs'
import { cp, lstat, mkdir, readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { FileEntry } from '@shared/domain'
import { fail } from '@shared/errors'

/** Never listed or searched: VCS internals and heavy generated folders (search only). */
const HIDDEN = new Set(['.git'])
const SEARCH_SKIP = new Set(['.git', 'node_modules', 'dist', 'out', 'build', '.next', '.venv', 'venv', '__pycache__', 'target', '.turbo', '.cache'])
const MAX_READ = 5 * 1024 * 1024
const MAX_SEARCH_RESULTS = 200
const MAX_SEARCH_VISITS = 30_000

/** Whether `abs` is `root` itself or below it. */
const inside = (root: string, abs: string): boolean => {
  const back = relative(root, abs)
  return back !== '..' && !back.startsWith(`..${sep}`) && !isAbsolute(back)
}

/** "a/b/c.ts" with forward slashes, the shape the renderer uses. */
const toRel = (root: string, abs: string): string => relative(root, abs).split(sep).join('/')

/**
 * Files of a Workspace (or Project) folder for the Explorer and editor panes.
 * Every path is relative to that folder and checked to stay inside it; the
 * renderer never names a folder, only a scope id.
 */
export class FileService {
  private readonly watchers = new Map<string, { watcher: FSWatcher; timer: NodeJS.Timeout | null; changed: Set<string> }>()

  constructor(
    private readonly trash: (path: string) => Promise<void>,
    private readonly onChanged: (scope: string, paths: string[]) => void = () => undefined
  ) {}

  /** Absolute path of `rel` inside `root`; refuses anything that escapes it. */
  resolveIn(root: string, rel: string): string {
    if (rel.includes('\0') || isAbsolute(rel)) fail('INVALID_INPUT', 'Paths must be relative to the folder.')
    const abs = resolve(root, rel || '.')
    if (!inside(root, abs)) fail('FORBIDDEN', 'That path is outside this folder.')
    // Git internals stay hidden and untouchable: a written hook would run on the next commit.
    if (relative(root, abs).split(sep).some((part) => HIDDEN.has(part))) fail('FORBIDDEN', 'Git internals cannot be edited here.')
    // A symlink or junction inside the folder must not lead out of it either. The path may not
    // exist yet (create, paste), so the nearest existing ancestor is checked.
    if (!existsSync(root)) fail('NOT_FOUND', 'This folder no longer exists.')
    let probe = abs
    while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
    if (!inside(realpathSync.native(root), realpathSync.native(probe))) fail('FORBIDDEN', 'That path leads outside this folder.')
    return abs
  }

  async list(root: string, dir: string): Promise<FileEntry[]> {
    const abs = this.resolveIn(root, dir)
    const entries = await readdir(abs, { withFileTypes: true }).catch(() => fail('NOT_FOUND', 'Folder not found.'))
    return entries
      .filter((e) => !HIDDEN.has(e.name))
      .map((e) => ({ name: e.name, path: toRel(root, join(abs, e.name)), kind: e.isDirectory() ? ('dir' as const) : ('file' as const) }))
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }) : a.kind === 'dir' ? -1 : 1))
  }

  /** Files whose path contains every word of the query (case-insensitive), best (shortest) first. */
  async search(root: string, query: string): Promise<FileEntry[]> {
    const words = query.toLowerCase().split(/[\s/\\]+/).filter(Boolean)
    if (!words.length) return []
    const found: FileEntry[] = []
    const queue = [root]
    let visits = 0
    while (queue.length && visits < MAX_SEARCH_VISITS && found.length < MAX_SEARCH_RESULTS * 3) {
      const dir = queue.shift()!
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
      for (const entry of entries) {
        visits++
        const abs = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (!SEARCH_SKIP.has(entry.name)) queue.push(abs)
          continue
        }
        const rel = toRel(root, abs)
        const hay = rel.toLowerCase()
        if (words.every((w) => hay.includes(w))) found.push({ name: entry.name, path: rel, kind: 'file' })
      }
    }
    const last = words[words.length - 1]!
    return found
      .sort((a, b) => Number(!a.name.toLowerCase().includes(last)) - Number(!b.name.toLowerCase().includes(last)) || a.path.length - b.path.length)
      .slice(0, MAX_SEARCH_RESULTS)
  }

  async read(root: string, rel: string): Promise<{ content: string; size: number }> {
    const abs = this.resolveIn(root, rel)
    const info = await stat(abs).catch(() => fail('NOT_FOUND', 'File not found.'))
    if (info.isDirectory()) fail('INVALID_INPUT', 'That is a folder.')
    if (info.size > MAX_READ) fail('INVALID_INPUT', 'This file is larger than 5 MB, too big to edit here.')
    const buffer = await readFile(abs)
    // A NUL byte in the first 8 KB means binary (images, archives…): not editable as text.
    if (buffer.subarray(0, 8192).includes(0)) fail('INVALID_INPUT', 'This is a binary file.')
    return { content: buffer.toString('utf8'), size: info.size }
  }

  async write(root: string, rel: string, content: string): Promise<void> {
    await writeFile(this.resolveIn(root, rel), content, 'utf8')
  }

  async create(root: string, rel: string, kind: 'file' | 'dir'): Promise<void> {
    const abs = this.resolveIn(root, rel)
    if (!basename(abs)) fail('INVALID_INPUT', 'Enter a name.')
    if (await exists(abs)) fail('INVALID_INPUT', `"${basename(abs)}" already exists.`)
    if (kind === 'dir') await mkdir(abs, { recursive: true })
    else {
      await mkdir(dirname(abs), { recursive: true })
      await writeFile(abs, '', { flag: 'wx' })
    }
  }

  async rename(root: string, from: string, to: string): Promise<void> {
    const source = this.resolveIn(root, from)
    const target = this.resolveIn(root, to)
    if (source === target) return
    if (await exists(target)) fail('INVALID_INPUT', `"${basename(target)}" already exists.`)
    await rename(source, target)
  }

  /** Moves each path to the OS trash (recoverable). */
  async remove(root: string, paths: string[]): Promise<void> {
    for (const rel of paths) {
      const abs = this.resolveIn(root, rel)
      if (abs === resolve(root)) fail('FORBIDDEN', 'The folder itself cannot be deleted here.')
      await this.trash(abs)
    }
  }

  /**
   * Pastes copied or cut entries into `targetDir`. Name clashes get " copy"
   * (" copy 2"…) like a file manager; moving a folder into itself is refused.
   */
  async paste(root: string, sources: string[], targetDir: string, mode: 'copy' | 'move'): Promise<string[]> {
    const dir = this.resolveIn(root, targetDir)
    const pasted: string[] = []
    for (const rel of sources) {
      const source = this.resolveIn(root, rel)
      if (dir === source || dir.startsWith(source + sep)) fail('INVALID_INPUT', 'A folder cannot be pasted into itself.')
      if (mode === 'move' && dirname(source) === dir) continue
      const target = await freeName(join(dir, basename(source)))
      if (mode === 'copy') await cp(source, target, { recursive: true, errorOnExist: true, force: false })
      else await rename(source, target)
      pasted.push(toRel(root, target))
    }
    return pasted
  }

  /** Reports changes under a scope's folder (debounced) while its Explorer is open. */
  watch(scope: string, root: string, on: boolean): void {
    const existing = this.watchers.get(scope)
    if (!on) {
      existing?.watcher.close()
      if (existing?.timer) clearTimeout(existing.timer)
      this.watchers.delete(scope)
      return
    }
    if (existing) return
    try {
      const entry = { watcher: null as unknown as FSWatcher, timer: null as NodeJS.Timeout | null, changed: new Set<string>() }
      entry.watcher = watch(root, { recursive: true }, (_event, file) => {
        const rel = file ? String(file).split(sep).join('/') : ''
        if (rel.split('/').some((part) => SEARCH_SKIP.has(part))) return
        entry.changed.add(rel)
        entry.timer ??= setTimeout(() => {
          entry.timer = null
          const paths = [...entry.changed]
          entry.changed.clear()
          this.onChanged(scope, paths)
        }, 200)
      })
      entry.watcher.on('error', () => this.watch(scope, root, false))
      this.watchers.set(scope, entry)
    } catch {
      // Watching is a convenience: the Explorer still refreshes on demand.
    }
  }

  closeAll(): void {
    for (const scope of [...this.watchers.keys()]) this.watch(scope, '', false)
  }
}

const exists = async (path: string): Promise<boolean> => {
  try {
    await lstat(path)
    return true
  } catch {
    return false
  }
}

/** "a.ts" → "a copy.ts" → "a copy 2.ts" until free. */
export const freeName = async (wanted: string): Promise<string> => {
  if (!(await exists(wanted))) return wanted
  const ext = extname(wanted)
  const stem = wanted.slice(0, wanted.length - ext.length)
  for (let n = 1; ; n++) {
    const candidate = `${stem} copy${n > 1 ? ` ${n}` : ''}${ext}`
    if (!(await exists(candidate))) return candidate
  }
}
