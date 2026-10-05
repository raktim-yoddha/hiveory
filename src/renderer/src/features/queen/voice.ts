import { create } from 'zustand'
import { CLIP_SAMPLE_RATE, MAX_CLIP_SECONDS, sentencesOf, SPEECH_LANGUAGES, speakable, type VoicePackState } from '@shared/queen/voice'
import { api, toAppError } from '../../lib/api'
import { useSettings } from '../../stores/data'
import { useQueen } from './useQueen'

type Phase = 'idle' | 'listening' | 'transcribing' | 'speaking'

interface VoiceState {
  packs: VoicePackState[]
  phase: Phase
  /** Loudness 0–1 of your voice while listening, or hers while speaking: drives the bar's waveform. */
  level: number
  load(): Promise<void>
  setPacks(packs: VoicePackState[]): void
}

export const useVoice = create<VoiceState>((set) => ({
  packs: [],
  phase: 'idle',
  level: 0,
  load: async () => {
    try {
      set({ packs: await api('voice.status') })
    } catch {
      // Voice stays unavailable; typing still works.
    }
  },
  setPacks: (packs) => set({ packs })
}))

const setPhase = (phase: Phase, level = 0): void => {
  if (phase === 'idle' || phase === 'transcribing') stopMeter()
  useVoice.setState({ phase, level })
}

let meterTimer: number | null = null
function stopMeter(): void {
  if (meterTimer !== null) window.clearInterval(meterTimer)
  meterTimer = null
}

/** Feeds the bar's waveform about 20 times a second (a timer, not a per-frame loop), only while audio flows. */
function startMeter(read: () => number): void {
  stopMeter()
  meterTimer = window.setInterval(() => useVoice.setState({ level: Math.max(0, Math.min(1, read())) }), 50)
}

/** RMS loudness of whatever passes through an analyser, scaled so speech fills most of the range. */
function loudness(analyser: AnalyserNode, gain: number): () => number {
  const samples = new Float32Array(analyser.fftSize)
  return () => {
    analyser.getFloatTimeDomainData(samples)
    let sum = 0
    for (const v of samples) sum += v * v
    return Math.sqrt(sum / samples.length) * gain
  }
}

/** Live microphone capture for one push-to-talk clip. */
let capture: { ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode; chunks: Float32Array[]; length: number } | null = null
/** Reply audio being made and played, sentence by sentence. */
let playing: { ctx: AudioContext | null; out: AnalyserNode | null; sources: AudioBufferSourceNode[]; at: number; done: boolean; stopped: boolean } | null = null

const MIN_SAMPLES = CLIP_SAMPLE_RATE * 0.3

const notify = (text: string): void => useQueen.getState().show({ kind: 'reply', text, receipts: [] })

/** The speech pack for the chosen language is downloaded. */
const sttReady = (): boolean => {
  const language = useSettings.getState().settings.queenSpeechLanguage
  const pack = SPEECH_LANGUAGES.find((l) => l.id === language)?.pack ?? 'parakeet'
  return useVoice.getState().packs.some((p) => p.id === pack && p.state === 'ready')
}

const ttsReady = (): boolean => useVoice.getState().packs.some((p) => p.id === 'kokoro' && p.state === 'ready')

export function stopSpeaking(): void {
  window.speechSynthesis?.cancel()
  if (playing) {
    playing.stopped = true
    for (const source of playing.sources) {
      try {
        source.stop()
      } catch {
        // Already finished.
      }
    }
    void playing.ctx?.close()
    playing = null
  }
  if (useVoice.getState().phase === 'speaking') setPhase('idle')
}

/** Her lines say your name the way you spelled it out for her (Settings › Personality). */
const pronounced = (text: string): string => {
  const { queenCallMe, queenCallMeSay } = useSettings.getState().settings
  return queenCallMe && queenCallMeSay ? text.split(queenCallMe).join(queenCallMeSay) : text
}

/** Without Kokoro she still talks: the operating system's own voice, which runs locally. */
function speakWithSystemVoice(text: string): void {
  const synth = window.speechSynthesis
  if (!synth) return
  const line = new SpeechSynthesisUtterance(text)
  const voices = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'))
  const voice = voices.find((v) => v.localService && v.default) ?? voices.find((v) => v.localService) ?? voices[0]
  if (voice) line.voice = voice
  line.rate = useSettings.getState().settings.queenVoiceSpeed
  line.onend = line.onerror = () => {
    if (useVoice.getState().phase === 'speaking') setPhase('idle')
  }
  // The system voice can't be measured: each word it reaches makes the waveform jump, then settle.
  let pulse = 1
  line.onboundary = () => {
    pulse = 1
  }
  setPhase('speaking')
  startMeter(() => {
    pulse *= 0.72
    return 0.2 + pulse * 0.7 + Math.random() * 0.1
  })
  synth.speak(line)
}

/** Her cue notes (Hz): a rising fifth, the same falling, one soft bell, a gentle three-note roll. */
const CUES = { listen: [659.25, 987.77], stop: [987.77, 659.25], done: [880], update: [783.99, 1046.5, 1318.51] }

/**
 * Short sound cues, generated (no audio files): listening starts and stops, an
 * answer arrived while talkback is off, an agent has an update. Each note is two
 * slightly detuned sines and a quiet octave, softened by a low-pass filter, with a
 * gentle attack and a long tail — a glassy chime rather than a beep.
 */
export function cue(kind: keyof typeof CUES): void {
  if (!useSettings.getState().settings.queenSounds) return
  try {
    const ctx = new AudioContext()
    const warm = ctx.createBiquadFilter()
    warm.type = 'lowpass'
    warm.frequency.value = 3200
    warm.connect(ctx.destination)
    CUES[kind].forEach((hz, i) => {
      const at = ctx.currentTime + 0.01 + i * 0.11
      const gain = ctx.createGain()
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.06, at + 0.025)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.55)
      gain.connect(warm)
      const partials: Array<[number, number, number]> = [
        [1, 1, -3],
        [1, 1, 3],
        [2, 0.18, 0]
      ]
      for (const [mult, level, cents] of partials) {
        const osc = ctx.createOscillator()
        const part = ctx.createGain()
        osc.type = 'sine'
        osc.frequency.value = hz * mult
        osc.detune.value = cents
        part.gain.value = level
        osc.connect(part).connect(gain)
        osc.start(at)
        osc.stop(at + 0.6)
      }
    })
    window.setTimeout(() => void ctx.close(), 1400)
  } catch {
    // No audio device: cues are optional.
  }
}

/**
 * Says a line out loud: Kokoro with her chosen voice when installed (sentence by
 * sentence, so she starts talking while the rest is still being made), otherwise
 * the system voice. Only the first two sentences: short is easier to listen to.
 * `sid` previews one voice without changing the setting.
 */
export async function speak(raw: string, options: { sid?: number; whole?: boolean } = {}): Promise<void> {
  const text = pronounced(options.whole ? raw.trim() : speakable(raw))
  if (!text) return
  stopSpeaking()
  if (!ttsReady()) return speakWithSystemVoice(text)
  const run: NonNullable<typeof playing> = { ctx: null, out: null, sources: [], at: 0, done: false, stopped: false }
  playing = run
  setPhase('speaking')
  const finished = (): void => {
    if (playing === run && run.done && run.ctx && run.ctx.currentTime >= run.at - 0.05) stopSpeaking()
  }
  try {
    for (const sentence of sentencesOf(text)) {
      const { samples, sampleRate } = await api('voice.speak', { text: sentence.slice(0, 600), ...(options.sid !== undefined ? { sid: options.sid } : {}) })
      if (run.stopped || useVoice.getState().phase === 'listening') return
      if (!run.ctx) {
        run.ctx = new AudioContext({ sampleRate })
        run.out = run.ctx.createAnalyser()
        run.out.fftSize = 512
        run.out.connect(run.ctx.destination)
        startMeter(loudness(run.out, 5))
      }
      const buffer = run.ctx.createBuffer(1, samples.length, sampleRate)
      buffer.copyToChannel(new Float32Array(samples), 0)
      const source = run.ctx.createBufferSource()
      source.buffer = buffer
      source.connect(run.out!)
      const start = Math.max(run.ctx.currentTime + 0.02, run.at)
      source.start(start)
      run.at = start + buffer.duration
      run.sources.push(source)
      source.onended = finished
    }
    run.done = true
    finished()
  } catch {
    if (playing === run) stopSpeaking()
  }
}

/**
 * Push-to-talk (ADR 0019): hold the shortcut or the mic button, speak, let go.
 * Audio stays on this computer: it is captured at 16 kHz mono and handed to the
 * local speech pack, never to a network service.
 */
export const queenVoice = {
  ready: sttReady,
  listening: (): boolean => capture !== null,

  async start(): Promise<void> {
    if (capture) return
    if (!sttReady()) {
      notify('Download a speech pack in Settings › Queen Bee › Voice to talk to me.')
      return
    }
    stopSpeaking()
    try {
      if (!(await api('voice.micAccess'))) {
        notify('Hiveory can’t use the microphone. Allow it in your system’s privacy settings.')
        return
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      const ctx = new AudioContext({ sampleRate: CLIP_SAMPLE_RATE })
      const source = ctx.createMediaStreamSource(stream)
      const node = ctx.createScriptProcessor(4096, 1, 1)
      const meter = ctx.createAnalyser()
      meter.fftSize = 512
      source.connect(meter)
      const clip = { ctx, stream, node, chunks: [] as Float32Array[], length: 0 }
      node.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0)
        clip.chunks.push(new Float32Array(data))
        clip.length += data.length
        if (clip.length >= CLIP_SAMPLE_RATE * MAX_CLIP_SECONDS) void queenVoice.stop()
      }
      // The node outputs silence; connecting it is what makes it run.
      source.connect(node)
      node.connect(ctx.destination)
      capture = clip
      setPhase('listening')
      startMeter(loudness(meter, 6))
      cue('listen')
    } catch (error) {
      setPhase('idle')
      notify(`The microphone didn’t start: ${error instanceof Error ? error.message : String(error)}`)
    }
  },

  async stop(): Promise<void> {
    const clip = capture
    if (!clip) return
    capture = null
    clip.node.disconnect()
    clip.stream.getTracks().forEach((t) => t.stop())
    void clip.ctx.close()
    if (clip.length < MIN_SAMPLES) {
      setPhase('idle')
      return
    }
    const samples = new Float32Array(clip.length)
    let offset = 0
    for (const chunk of clip.chunks) {
      samples.set(chunk, offset)
      offset += chunk.length
    }
    cue('stop')
    setPhase('transcribing')
    try {
      const { text } = await api('voice.transcribe', { samples, language: useSettings.getState().settings.queenSpeechLanguage })
      setPhase('idle')
      if (!text) {
        notify('I didn’t catch that.')
        return
      }
      // Imported late: the executor imports this module for speaking.
      const { runQueen } = await import('./queen-run')
      await runQueen(text, { spoken: true })
    } catch (error) {
      setPhase('idle')
      notify(toAppError(error).message)
    }
  }
}
