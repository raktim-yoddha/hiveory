import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fail } from '@shared/errors'
import { CLIP_SAMPLE_RATE, MAX_CLIP_SECONDS, SPEECH_LANGUAGES, VOICE_PACKS, type SpeechLanguage, type VoiceFile, type VoicePack, type VoicePackId, type VoicePackState } from '@shared/queen/voice'
import type { Logger } from '../../app/logger'
import type { Emit } from '../events'
import { VoiceEngine } from './voice-engine'

type Fetch = typeof fetch

/** The OS's own tar unpacks .tar.bz2 (bsdtar on Windows 10+ and macOS; GNU tar with bzip2 on Linux). */
const tarPath = (): string => (process.platform === 'win32' ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar')

const run = (file: string, args: string[]): Promise<void> =>
  new Promise((resolve, reject) => execFile(file, args, { timeout: 120_000 }, (error) => (error ? reject(error) : resolve())))

/** sha256 of a file, streamed. */
export const hashFile = async (path: string): Promise<string> => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/**
 * Queen Bee's local voice (ADR 0019): downloads speech packs on request — every
 * file from a pinned URL, resumable, and verified against its SHA-256 before it
 * is used — then runs recognition and synthesis on this computer.
 */
export class VoiceService {
  private readonly engine = new VoiceEngine()
  private readonly jobs = new Map<VoicePackId, { abort: AbortController; received: number; total: number; verifying: boolean }>()
  private readonly errors = new Map<VoicePackId, string>()
  private lastEmit = 0

  constructor(
    private readonly dir: string,
    private readonly emit: Emit,
    private readonly log: Logger,
    private readonly http: Fetch = fetch,
    private readonly packs: VoicePack[] = VOICE_PACKS
  ) {}

  private packDir(id: VoicePackId): string {
    return join(this.dir, id)
  }

  /** A file is usable once its `.ok` marker holds its expected hash. */
  private ready(id: VoicePackId): boolean {
    const pack = this.packs.find((p) => p.id === id)!
    return pack.files.every((f) => existsSync(join(this.packDir(id), `${f.path}.ok`)) && (f.extract || existsSync(join(this.packDir(id), f.path))))
  }

  status(): VoicePackState[] {
    return this.packs.map((p): VoicePackState => {
      const job = this.jobs.get(p.id)
      if (job) return job.verifying ? { id: p.id, state: 'verifying' } : { id: p.id, state: 'downloading', received: job.received, total: job.total }
      if (this.ready(p.id)) return { id: p.id, state: 'ready' }
      const error = this.errors.get(p.id)
      return error ? { id: p.id, state: 'error', error } : { id: p.id, state: 'missing' }
    })
  }

  private changed(force = false): void {
    const now = Date.now()
    if (!force && now - this.lastEmit < 200) return
    this.lastEmit = now
    this.emit('voice.changed', this.status())
  }

  /** Starts (or resumes) a pack's download in the background. */
  download(id: VoicePackId): void {
    const pack = this.packs.find((p) => p.id === id)
    if (!pack) fail('NOT_FOUND', 'Unknown voice pack.')
    if (this.jobs.has(id) || this.ready(id)) return
    const job = { abort: new AbortController(), received: 0, total: pack!.files.reduce((n, f) => n + f.size, 0), verifying: false }
    this.jobs.set(id, job)
    this.errors.delete(id)
    this.changed(true)
    void (async () => {
      try {
        await mkdir(this.packDir(id), { recursive: true })
        for (const file of pack!.files) await this.fetchFile(id, file, job)
      } catch (error) {
        const message = job.abort.signal.aborted ? null : error instanceof Error ? error.message : String(error)
        if (message) {
          this.errors.set(id, message)
          this.log.warn(`Voice pack ${id}: ${message}`)
        }
      } finally {
        this.jobs.delete(id)
        this.changed(true)
      }
    })()
  }

  cancel(id: VoicePackId): void {
    this.jobs.get(id)?.abort.abort()
  }

  async remove(id: VoicePackId): Promise<void> {
    this.cancel(id)
    this.engine.unload(id)
    this.errors.delete(id)
    // Only ever Hiveory's own folder for that pack.
    await rm(this.packDir(id), { recursive: true, force: true })
    this.changed(true)
  }

  private async fetchFile(id: VoicePackId, file: VoiceFile, job: { abort: AbortController; received: number; verifying: boolean }): Promise<void> {
    const dir = this.packDir(id)
    const dest = join(dir, file.path)
    const marker = `${dest}.ok`
    if (existsSync(marker) && (await readFile(marker, 'utf8')).trim() === file.sha256 && (file.extract || existsSync(dest))) {
      job.received += file.size
      return
    }
    const part = `${dest}.part`
    const hash = createHash('sha256')
    let start = existsSync(part) ? (await stat(part)).size : 0
    if (start > file.size) {
      await rm(part, { force: true })
      start = 0
    }
    // Resuming: the bytes already on disk count toward the hash.
    if (start) for await (const chunk of createReadStream(part)) hash.update(chunk as Buffer)
    const res = await this.http(file.url, { headers: start ? { Range: `bytes=${start}-` } : {}, signal: job.abort.signal, redirect: 'follow' })
    if (!res.url.startsWith('https://')) fail('INVALID_INPUT', 'The download was redirected somewhere unsafe.')
    if (start && res.status === 200) {
      // The server ignored the range: start over.
      await rm(part, { force: true })
      return this.fetchFile(id, file, job)
    }
    if (!(res.ok || res.status === 206) || !res.body) fail('INVALID_INPUT', `Download failed (${res.status}).`)
    job.received += start
    const out = createWriteStream(part, { flags: start ? 'a' : 'w' })
    const body = Readable.fromWeb(res.body as unknown as import('node:stream/web').ReadableStream)
    const meter = new Transform({
      transform: (chunk: Buffer, _encoding, done) => {
        hash.update(chunk)
        job.received += chunk.length
        this.changed()
        done(null, chunk)
      }
    })
    await pipeline(body, meter, out, { signal: job.abort.signal })
    const size = (await stat(part)).size
    const digest = hash.digest('hex')
    if (size !== file.size || digest !== file.sha256) {
      await rm(part, { force: true })
      fail('INVALID_INPUT', `${file.path} did not match its checksum and was discarded. Try again.`)
    }
    await rename(part, dest)
    if (file.extract) {
      job.verifying = true
      this.changed(true)
      await run(tarPath(), ['-xjf', dest, '-C', dir])
      await rm(dest, { force: true })
      job.verifying = false
    }
    await writeFile(marker, file.sha256)
  }

  /** Push-to-talk audio (16 kHz mono) → text, in the chosen language. */
  async transcribe(samples: Float32Array, language: SpeechLanguage): Promise<{ text: string; ms: number }> {
    if (samples.length > CLIP_SAMPLE_RATE * MAX_CLIP_SECONDS) fail('INVALID_INPUT', `Clips are limited to ${MAX_CLIP_SECONDS} seconds.`)
    const pack = SPEECH_LANGUAGES.find((l) => l.id === language)?.pack ?? 'parakeet'
    if (!this.ready(pack)) fail('NOT_FOUND', `Download ${pack === 'whisper' ? 'Whisper Turbo' : 'Parakeet'} in Settings › Queen Bee › Voice first.`)
    const started = Date.now()
    const text = await this.engine.transcribe(pack, this.packDir(pack), samples)
    return { text, ms: Date.now() - started }
  }

  /** Text → speech with a persona's voice. */
  async speak(text: string, sid: number, speed: number): Promise<{ samples: Float32Array; sampleRate: number }> {
    if (!this.ready('kokoro')) fail('NOT_FOUND', 'Download Kokoro in Settings › Queen Bee › Voice first.')
    return this.engine.speak(this.packDir('kokoro'), text, sid, speed)
  }
}
