import { lstatSync, mkdirSync } from 'node:fs'

/**
 * Makes `path` a folder only this user can enter, or throws (ADR 0050 amendment). It is created
 * 0700, then checked to be a real folder (not a link) owned by this user with no access for anyone
 * else, so a folder someone else made first in a shared temporary folder is never used: tmux's
 * rule for its sockets in /tmp/tmux-<uid>.
 */
export const ownPrivateDir = (path: string, uid: number): void => {
  try {
    mkdirSync(path, { mode: 0o700 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  const stat = lstatSync(path)
  if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) {
    throw new Error(`hiveoryd: not using ${path} for its socket: it is not a folder of this user's alone`)
  }
}
