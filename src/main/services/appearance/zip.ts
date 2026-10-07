import { inflateRawSync } from 'node:zlib'
import { fail } from '@shared/errors'

/** Largest single entry read out of an archive (theme files are kilobytes). */
const MAX_ENTRY_BYTES = 8 * 1024 * 1024

/**
 * Reads a .zip (a VS Code .vsix) from memory: entry name → lazy contents.
 * ponytail: stored and deflated entries only, no zip64; enough for .vsix files.
 */
export const readZip = (buf: Buffer): Map<string, () => Buffer> => {
  // End of central directory: the last 0x06054b50 within the 64 KiB comment window.
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) fail('INVALID_INPUT', 'That extension is not a valid package.')
  const count = buf.readUInt16LE(eocd + 10)
  let at = buf.readUInt32LE(eocd + 16)
  const entries = new Map<string, () => Buffer>()
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) fail('INVALID_INPUT', 'That extension package is damaged.')
    const method = buf.readUInt16LE(at + 10)
    const compressed = buf.readUInt32LE(at + 20)
    const size = buf.readUInt32LE(at + 24)
    const nameLength = buf.readUInt16LE(at + 28)
    const extra = buf.readUInt16LE(at + 30)
    const comment = buf.readUInt16LE(at + 32)
    const local = buf.readUInt32LE(at + 42)
    const name = buf.toString('utf8', at + 46, at + 46 + nameLength)
    at += 46 + nameLength + extra + comment
    entries.set(name, () => {
      if (size > MAX_ENTRY_BYTES) fail('INVALID_INPUT', `${name} is too large.`)
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) fail('INVALID_INPUT', 'That extension package is damaged.')
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + compressed)
      if (method === 0) return Buffer.from(data)
      if (method === 8) return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES })
      return fail('INVALID_INPUT', `${name} uses an unsupported compression.`)
    })
  }
  return entries
}
