import { randomBytes } from 'node:crypto'
import { chmodSync, linkSync, lstatSync, renameSync, unlinkSync } from 'node:fs'
import { connect, type Server } from 'node:net'
import { dirname, join } from 'node:path'

/** Whether something serves `path`: only a refusal or a missing entry proves nothing does (ADR 0050 §3). */
export const probe = (path: string): Promise<'connected' | 'dead' | 'unknown'> =>
  new Promise((resolve) => {
    const socket = connect(path)
    const timer = setTimeout(() => {
      socket.destroy()
      resolve('unknown')
    }, 1000)
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve('connected')
    })
    socket.once('error', (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      resolve(error.code === 'ECONNREFUSED' || error.code === 'ENOENT' ? 'dead' : 'unknown')
    })
  })

const listen = (server: Server, path: string): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(path, () => {
      server.off('error', reject)
      resolve()
    })
  })

const inode = (path: string): number | null => {
  try {
    return lstatSync(path).ino
  } catch {
    return null
  }
}

/**
 * Puts `server` on `path`, or answers false when another daemon owns it (ADR 0050 §3). Only a
 * daemon publishing itself changes the entry, and only to replace one it just proved dead; nothing
 * else ever removes it. A Windows pipe vanishes with its owner, so there a busy name means owned.
 */
export const publish = async (server: Server, path: string): Promise<boolean> => {
  if (process.platform === 'win32') {
    try {
      await listen(server, path)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EADDRINUSE') return false
      throw error
    }
  }
  const scratch = join(dirname(path), `.p${randomBytes(6).toString('hex')}`)
  await listen(server, scratch)
  chmodSync(scratch, 0o600)
  try {
    try {
      linkSync(scratch, path)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    const before = inode(path)
    if ((await probe(path)) !== 'dead' || inode(path) !== before) {
      server.close()
      return false
    }
    renameSync(scratch, path)
    return true
  } finally {
    try {
      unlinkSync(scratch)
    } catch {
      // Renamed onto the endpoint already.
    }
  }
}
