import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PERSONA_VOICES } from '@shared/queen/voice'
import { VoiceEngine } from './voice-engine'

/**
 * Real speech round trip with the downloaded packs: Kokoro says a command, each
 * recognizer hears it back. Opt-in (the packs are ~2 GB): set HIVEORY_VOICE_MODELS
 * to a folder holding parakeet/, whisper/ and kokoro/.
 */
const root = process.env.HIVEORY_VOICE_MODELS
const run = root && existsSync(join(root, 'kokoro')) ? describe : describe.skip

/** Linear resample to the 16 kHz recognizers expect (the mic already records at 16 kHz). */
const to16k = (samples: Float32Array, rate: number): Float32Array => {
  const out = new Float32Array(Math.floor((samples.length * 16000) / rate))
  for (let i = 0; i < out.length; i++) {
    const x = (i * rate) / 16000
    const j = Math.floor(x)
    out[i] = (samples[j] ?? 0) + ((samples[j + 1] ?? 0) - (samples[j] ?? 0)) * (x - j)
  }
  return out
}

run('voice engine (real models)', () => {
  const engine = new VoiceEngine()

  it('speaks with each persona voice and hears it back', async () => {
    const said = 'Open two Codex agents in feature x.'
    const audio = await engine.speak(join(root!, 'kokoro'), said, PERSONA_VOICES.ada.sid, 1)
    expect(audio.sampleRate).toBe(24000)
    expect(audio.samples.length).toBeGreaterThan(24000)
    const clip = to16k(audio.samples, audio.sampleRate)

    const parakeet = await engine.transcribe('parakeet', join(root!, 'parakeet'), clip)
    expect(parakeet.toLowerCase()).toMatch(/open two codex agents/)

    const whisper = await engine.transcribe('whisper', join(root!, 'whisper'), clip)
    expect(whisper.toLowerCase()).toMatch(/open/)
    expect(whisper.toLowerCase()).toMatch(/agent/)
  }, 180_000)
})
