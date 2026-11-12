import { chmodSync, mkdirSync, mkdtempSync, statSync, symlinkSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { localEndpointPath, shortSocketDir, socketPathMax } from '../main/services/hosts/local-endpoint'
import { publish } from './endpoint-owner'
import { ownPrivateDir } from './socket-dir'

/** The profile folder that kept the terminal host from starting on a macOS CI runner: its socket path was 108 bytes. */
const MAC_CI = '/var/folders/h5/t85nd63d71x27_8gl5gw3l_w0000gn/T/hiveory-e2e-ZhHcAV/profile/Runtime/hiveoryd'
const MAC_TMP = '/var/folders/h5/t85nd63d71x27_8gl5gw3l_w0000gn/T'

describe('where the terminal host listens (ADR 0050 amendment)', () => {
  it('keeps the socket in the profile folder when its path fits', () => {
    expect(shortSocketDir('/Users/me/Library/Application Support/Hiveory/Runtime/hiveoryd', 3, { platform: 'darwin', tmp: MAC_TMP, uid: 501 })).toBeNull()
    expect(shortSocketDir('/home/me/.local/share/hiveory/Runtime/hiveoryd', 3, { platform: 'linux', tmp: '/tmp', uid: 1000 })).toBeNull()
  })

  it('moves a socket path the system cannot take to a short folder of this user (the macOS CI case)', () => {
    expect(Buffer.byteLength(localEndpointPath(MAC_CI, 3, 'darwin'))).toBeGreaterThan(socketPathMax('darwin'))
    const short = shortSocketDir(MAC_CI, 3, { platform: 'darwin', tmp: MAC_TMP, uid: 501 })!
    expect(short.startsWith(`${MAC_TMP}/hiveoryd-501-`)).toBe(true)
    expect(Buffer.byteLength(localEndpointPath(short, 3, 'darwin'))).toBeLessThanOrEqual(socketPathMax('darwin'))
  })

  it("on Linux uses the user's runtime folder when it is set and absolute", () => {
    const long = `/home/${'a'.repeat(80)}/.local/share/hiveory/Runtime/hiveoryd`
    expect(shortSocketDir(long, 3, { platform: 'linux', runtimeDir: '/run/user/1000', tmp: '/tmp', uid: 1000 })!.startsWith('/run/user/1000/hiveoryd-1000-')).toBe(true)
    expect(shortSocketDir(long, 3, { platform: 'linux', runtimeDir: 'relative/dir', tmp: '/tmp', uid: 1000 })!.startsWith('/tmp/hiveoryd-1000-')).toBe(true)
  })

  it('gives each profile its own folder, the same one every time', () => {
    const a = shortSocketDir(`${MAC_CI}-a`, 3, { platform: 'darwin', tmp: MAC_TMP, uid: 501 })
    expect(a).toBe(shortSocketDir(`${MAC_CI}-a`, 3, { platform: 'darwin', tmp: MAC_TMP, uid: 501 }))
    expect(a).not.toBe(shortSocketDir(`${MAC_CI}-b`, 3, { platform: 'darwin', tmp: MAC_TMP, uid: 501 }))
  })

  it('never moves a Windows pipe', () => {
    expect(shortSocketDir(`C:\\${'x'.repeat(200)}`, 3, { platform: 'win32', tmp: 'C:\\Temp', uid: 0 })).toBeNull()
  })
})

const close = (server: Server): Promise<void> => new Promise((done) => server.close(() => done()))

// Folder permissions and Unix sockets: macOS and Linux only (these run in CI there).
describe.skipIf(process.platform === 'win32')('a private socket folder (ADR 0050 amendment)', () => {
  const uid = process.getuid?.() ?? 0

  it('is created for this user alone, and taken again as it is', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'hv-sock-')), 'own')
    ownPrivateDir(dir, uid)
    expect(statSync(dir).mode & 0o777).toBe(0o700)
    expect(() => ownPrivateDir(dir, uid)).not.toThrow()
  })

  it('is refused when others can enter it, or when it is a link', () => {
    const root = mkdtempSync(join(tmpdir(), 'hv-sock-'))
    const open = join(root, 'open')
    mkdirSync(open)
    chmodSync(open, 0o755)
    expect(() => ownPrivateDir(open, uid)).toThrow(/not a folder of this user's alone/)
    const target = join(root, 'target')
    mkdirSync(target, { mode: 0o700 })
    symlinkSync(target, join(root, 'link'))
    expect(() => ownPrivateDir(join(root, 'link'), uid)).toThrow(/not a folder of this user's alone/)
    expect(() => ownPrivateDir(target, uid + 1)).toThrow(/not a folder of this user's alone/)
  })

  it('lets a daemon listen for a profile folder whose own socket path the system refuses', async () => {
    let dir = mkdtempSync(join(tmpdir(), 'hv-sock-'))
    while (Buffer.byteLength(localEndpointPath(dir, 3)) <= socketPathMax()) dir = join(dir, 'a-rather-long-folder-name')
    mkdirSync(dir, { recursive: true })
    // The bug: listening in the profile folder fails.
    const direct = createServer()
    await expect(publish(direct, localEndpointPath(dir, 3))).rejects.toThrow()
    // The fix: a short folder of this user's own.
    const short = shortSocketDir(dir, 3, { runtimeDir: process.env.XDG_RUNTIME_DIR, tmp: tmpdir(), uid })!
    ownPrivateDir(short, uid)
    const server = createServer()
    expect(await publish(server, localEndpointPath(short, 3))).toBe(true)
    expect(statSync(localEndpointPath(short, 3)).mode & 0o777).toBe(0o600)
    await close(server)
  })
})
