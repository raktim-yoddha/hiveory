import { execFile, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { findExecutable, processDiscoveryEnv } from '../cli/discovery'

export interface SpawnTarget {
  file: string
  args: string[]
}

/** Characters cmd.exe interprets even inside arguments; never pass user text through it. */
const CMD_META = /[&|<>^%!"\r\n]/

/**
 * Resolves a CLI executable into something spawnable *without a shell*.
 * npm installs `.cmd` shims on Windows; going through cmd.exe would let
 * characters in a chat message act as shell syntax. We read the shim, find
 * the real target (an .exe, or a node script) and spawn that directly.
 */
export const resolveSpawnTarget = (
  executable: string,
  args: string[],
  read: (file: string) => string = (f) => readFileSync(f, 'utf8'),
  exists: (file: string) => boolean = existsSync,
  findNode: () => string | undefined = () => findExecutable('node', processDiscoveryEnv())
): SpawnTarget => {
  const ext = extname(executable).toLowerCase()
  if (process.platform !== 'win32' || (ext !== '.cmd' && ext !== '.bat')) return { file: executable, args }

  let shim: string
  try {
    shim = read(executable)
  } catch {
    shim = ''
  }
  const dir = dirname(executable)
  const targets = [...shim.matchAll(/"%~?dp0%?\\([^"]+)"/g)].map((m) => join(dir, m[1] as string))
  const target = targets.find((t) => !/node(\.exe)?$/i.test(t) && exists(t))
  if (target) {
    if (extname(target).toLowerCase() === '.exe') return { file: target, args }
    const localNode = join(dir, 'node.exe')
    const node = exists(localNode) ? localNode : findNode()
    if (node) return { file: node, args: [target, ...args] }
  }
  // Last resort: cmd.exe, but only when no argument could be read as shell syntax.
  const unsafe = args.find((a) => CMD_META.test(a))
  if (unsafe !== undefined) {
    throw new Error(`Cannot safely pass this text to ${executable} through cmd.exe.`)
  }
  return { file: process.env.ComSpec ?? 'cmd.exe', args: ['/d', '/s', '/c', executable, ...args] }
}

/** Ends a process and its children (CLIs spawn helpers; Windows needs taskkill /T). */
export const killTree = (child: ChildProcess): void => {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => undefined)
  } else {
    try {
      child.kill('SIGTERM')
    } catch {
      // Already gone.
    }
  }
}
