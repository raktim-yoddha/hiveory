import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { VoicePackId } from '@shared/queen/voice'

/** The parts of sherpa-onnx-node Hiveory uses (the package ships no types). */
interface Recognizer {
  createStream(): { acceptWaveform(w: { samples: Float32Array; sampleRate: number }): void }
  decodeAsync(stream: unknown): Promise<void>
  getResult(stream: unknown): { text: string }
}
interface Tts {
  sampleRate: number
  generateAsync(req: { text: string; sid: number; speed: number; enableExternalBuffer?: boolean }): Promise<{ samples: Float32Array; sampleRate: number }>
}
interface Sherpa {
  OfflineRecognizer: { createAsync(config: unknown): Promise<Recognizer> }
  OfflineTts: { createAsync(config: unknown): Promise<Tts> }
}

// Loaded on first use: the native module costs nothing until someone speaks.
let sherpa: Sherpa | null = null
const load = (): Sherpa => (sherpa ??= createRequire(import.meta.url)('sherpa-onnx-node') as Sherpa)

const threads = (): number => 2

/**
 * Recognizer config per pack. Whisper writes in Latin script ("do codex kholo"):
 * CLI and page names stay English and the rule parser knows common Hinglish verbs.
 * (Turbo can't translate reliably, and Devanagari would bypass the rules entirely.)
 */
export const recognizerConfig = (pack: Exclude<VoicePackId, 'kokoro'>, dir: string) =>
  pack === 'parakeet'
    ? {
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          transducer: { encoder: join(dir, 'encoder.int8.onnx'), decoder: join(dir, 'decoder.int8.onnx'), joiner: join(dir, 'joiner.int8.onnx') },
          tokens: join(dir, 'tokens.txt'),
          modelType: 'nemo_transducer',
          numThreads: threads(),
          provider: 'cpu',
          debug: 0
        }
      }
    : {
        featConfig: { sampleRate: 16000, featureDim: 80 },
        modelConfig: {
          whisper: { encoder: join(dir, 'turbo-encoder.int8.onnx'), decoder: join(dir, 'turbo-decoder.int8.onnx'), language: 'en', task: 'transcribe', tailPaddings: -1 },
          tokens: join(dir, 'turbo-tokens.txt'),
          numThreads: threads(),
          provider: 'cpu',
          debug: 0
        }
      }

export const ttsConfig = (dir: string) => ({
  model: {
    kokoro: {
      model: join(dir, 'model.onnx'),
      voices: join(dir, 'voices.bin'),
      tokens: join(dir, 'tokens.txt'),
      dataDir: join(dir, 'espeak-ng-data'),
      lexicon: `${join(dir, 'lexicon-us-en.txt')},${join(dir, 'lexicon-gb-en.txt')}`
    },
    numThreads: threads(),
    provider: 'cpu',
    debug: 0
  },
  maxNumSentences: 2
})

/** Unused models leave memory after this long; the next request loads them again. */
const IDLE_MS = 10 * 60 * 1000

/**
 * Runs speech recognition and synthesis in-process, off the main thread
 * (sherpa's async calls use a worker pool). Models load lazily and unload
 * when idle so Queen Bee costs no memory while nobody talks to her.
 */
export class VoiceEngine {
  private recognizers = new Map<string, { recognizer: Promise<Recognizer>; used: number }>()
  private tts: { engine: Promise<Tts>; dir: string; used: number } | null = null
  private sweep: NodeJS.Timeout | null = null

  async transcribe(pack: Exclude<VoicePackId, 'kokoro'>, dir: string, samples: Float32Array): Promise<string> {
    let entry = this.recognizers.get(pack)
    if (!entry) {
      // Only one recognizer stays loaded: switching language frees the other.
      this.recognizers.clear()
      entry = { recognizer: load().OfflineRecognizer.createAsync(recognizerConfig(pack, dir)), used: Date.now() }
      entry.recognizer.catch(() => this.recognizers.delete(pack))
      this.recognizers.set(pack, entry)
    }
    entry.used = Date.now()
    this.arm()
    const recognizer = await entry.recognizer
    const stream = recognizer.createStream()
    stream.acceptWaveform({ samples, sampleRate: 16000 })
    await recognizer.decodeAsync(stream)
    return recognizer.getResult(stream).text.trim()
  }

  async speak(dir: string, text: string, sid: number, speed: number): Promise<{ samples: Float32Array; sampleRate: number }> {
    if (!this.tts || this.tts.dir !== dir) {
      const engine = load().OfflineTts.createAsync(ttsConfig(dir))
      engine.catch(() => {
        if (this.tts?.engine === engine) this.tts = null
      })
      this.tts = { engine, dir, used: Date.now() }
    }
    this.tts.used = Date.now()
    this.arm()
    // Electron's V8 memory cage forbids native external buffers: have sherpa copy the samples.
    const audio = await (await this.tts.engine).generateAsync({ text, sid, speed, enableExternalBuffer: false })
    return { samples: audio.samples, sampleRate: audio.sampleRate }
  }

  /** Forget a pack's loaded model (before its files are removed). */
  unload(pack: VoicePackId): void {
    if (pack === 'kokoro') this.tts = null
    else this.recognizers.delete(pack)
  }

  private arm(): void {
    this.sweep ??= setInterval(() => {
      const now = Date.now()
      for (const [pack, entry] of this.recognizers) if (now - entry.used > IDLE_MS) this.recognizers.delete(pack)
      if (this.tts && now - this.tts.used > IDLE_MS) this.tts = null
      if (!this.recognizers.size && !this.tts && this.sweep) {
        clearInterval(this.sweep)
        this.sweep = null
      }
    }, 60_000)
    this.sweep.unref?.()
  }
}
