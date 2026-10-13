import { accessSync, constants, statSync } from 'node:fs'
import { posix, win32 } from 'node:path'

export interface DiscoveryEnv {
  platform: NodeJS.Platform
  path: string
  pathExt?: string
  isExecutable?: (file: string) => boolean
}

const defaultIsExecutable =
  (platform: NodeJS.Platform) =>
  (file: string): boolean => {
    try {
      if (!statSync(file).isFile()) return false
      if (platform !== 'win32') accessSync(file, constants.X_OK)
      return true
    } catch {
      return false
    }
  }

/**
 * Resolves an executable on PATH without spawning a shell. On Windows only
 * PATHEXT extensions count, so extensionless npm shell shims are skipped.
 */
export const findExecutable = (name: string, env: DiscoveryEnv): string | undefined => {
  const isExecutable = env.isExecutable ?? defaultIsExecutable(env.platform)
  // Paths of the platform asked about, not the one running (tests check Windows from Linux and macOS).
  const { delimiter: sep, join } = env.platform === 'win32' ? win32 : posix
  const dirs = env.path.split(sep).map((d) => d.trim().replace(/^"(.*)"$/, '$1')).filter(Boolean)
  const extensions =
    env.platform === 'win32'
      ? (env.pathExt ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((e) => e.toLowerCase())
      : ['']
  for (const dir of dirs) {
    for (const ext of extensions) {
      const candidate = join(dir, name + ext)
      if (isExecutable(candidate)) return candidate
    }
  }
  return undefined
}

export const processDiscoveryEnv = (): DiscoveryEnv => ({
  platform: process.platform,
  path: process.env.PATH ?? process.env.Path ?? '',
  pathExt: process.env.PATHEXT
})
