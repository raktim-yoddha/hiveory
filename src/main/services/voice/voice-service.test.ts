import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { VoicePack } from '@shared/queen/voice'
import { VoiceService } from './voice-service'

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const bytes = Buffer.from('0123456789'.repeat(1000))
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

const pack = (sha256: string): VoicePack => ({
  id: 'parakeet',
  kind: 'listen',
  name: 'Test',
  description: '',
  languages: '',
  license: '',
  files: [{ path: 'model.bin', url: 'https://models.example/model.bin', sha256, size: bytes.length }]
})

/** Serves `bytes`, honouring Range requests the way Hugging Face does. */
const server = (seen: string[]) =>
  (async (_url: string, init: RequestInit) => {
    const range = (init.headers as Record<string, string>)?.Range
    seen.push(range ?? 'full')
    const from = range ? Number(/bytes=(\d+)-/.exec(range)![1]) : 0
    const res = new Response(bytes.subarray(from), { status: range ? 206 : 200 })
    Object.defineProperty(res, 'url', { value: 'https://cdn.models.example/model.bin' })
    return res
  }) as unknown as typeof fetch

const done = async (voice: VoiceService) => {
  for (let i = 0; i < 200 && voice.status()[0]!.state !== 'ready' && voice.status()[0]!.state !== 'error'; i++) await new Promise((r) => setTimeout(r, 10))
  return voice.status()[0]!
}

describe('voice pack downloads', () => {
  it('downloads, verifies and marks a pack ready', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hv-voice-'))
    const voice = new VoiceService(dir, () => undefined, log, server([]), [pack(sha(bytes))])
    voice.download('parakeet')
    expect(await done(voice)).toEqual({ id: 'parakeet', state: 'ready' })
    expect(readFileSync(join(dir, 'parakeet', 'model.bin'))).toEqual(bytes)
  })

  it('resumes a partial download and still checks the whole file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hv-voice-'))
    mkdirSync(join(dir, 'parakeet'))
    writeFileSync(join(dir, 'parakeet', 'model.bin.part'), bytes.subarray(0, 4000))
    const seen: string[] = []
    const voice = new VoiceService(dir, () => undefined, log, server(seen), [pack(sha(bytes))])
    voice.download('parakeet')
    expect((await done(voice)).state).toBe('ready')
    expect(seen).toEqual(['bytes=4000-'])
    expect(readFileSync(join(dir, 'parakeet', 'model.bin'))).toEqual(bytes)
  })

  it('throws away a file that does not match its checksum', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hv-voice-'))
    const voice = new VoiceService(dir, () => undefined, log, server([]), [pack('0'.repeat(64))])
    voice.download('parakeet')
    const state = await done(voice)
    expect(state).toMatchObject({ state: 'error', error: expect.stringMatching(/checksum/) })
    expect(existsSync(join(dir, 'parakeet', 'model.bin'))).toBe(false)
    expect(existsSync(join(dir, 'parakeet', 'model.bin.part'))).toBe(false)
  })

  it('refuses audio clips that are too long, and speech before a pack is installed', async () => {
    const voice = new VoiceService(mkdtempSync(join(tmpdir(), 'hv-voice-')), () => undefined, log, server([]), [pack(sha(bytes))])
    await expect(voice.transcribe(new Float32Array(16000 * 61), 'en')).rejects.toThrow(/60 seconds/)
    await expect(voice.transcribe(new Float32Array(16000), 'en')).rejects.toThrow(/Download Parakeet/)
  })
})
