import { create } from 'zustand'
import { CLIP_SAMPLE_RATE, MAX_CLIP_SECONDS, SPEECH_LANGUAGES, type VoicePackState } from '@shared/queen/voice'
import { api, toAppError } from '../../lib/api'
import { useSettings } from '../../stores/data'
import { useQueen } from './useQueen'

type Phase = 'idle' | 'listening' | 'transcribing' | 'speaking'

interface VoiceState {
  packs: VoicePackState[]
  phase: Phase
  /** Microphone level 0–1 while listening (drives the bar's meter). */
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

const setPhase = (phase: Phase, level = 0): void => useVoice.setState({ phase, level })

/** Live microphone capture for one push-to-talk clip. */
let capture: { ctx: AudioContext; stream: MediaStream; node: ScriptProcessorNode; chunks: Float32Array[]; length: number } | null = null
/** Reply audio that is playing. */
let playing: { ctx: AudioContext; source: AudioBufferSourceNode } | null = null

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
    try {
      playing.source.stop()
    } catch {
      // Already finished.
    }
    void playing.ctx.close()
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
  setPhase('speaking')
  synth.speak(line)
}

/**
 * Short sound cues, generated (no audio files): listening starts and stops, an
 * answer arrived while talkback is off, an agent has an update.
 */
export function cue(kind: 'listen' | 'stop' | 'done' | 'update'): void {
  if (!useSettings.getState().settings.queenSounds) return
  try {
    const ctx = new AudioContext()
    const notes = { listen: [660, 880], stop: [880, 660], done: [784, 1047], update: [523, 659, 784] }[kind]
    notes.forEach((hz, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const at = ctx.currentTime + i * 0.09
      osc.type = 'sine'
      osc.frequency.value = hz
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.12, at + 0.015)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + 0.18)
    })
    window.setTimeout(() => void ctx.close(), 900)
  } catch {
    // No audio device: cues are optional.
  }
}

/** Says a line out loud: Kokoro with her chosen voice when installed, otherwise the system voice. */
export async function speak(raw: string): Promise<void> {
  const text = pronounced(raw.trim())
  if (!text) return
  stopSpeaking()
  if (!ttsReady()) return speakWithSystemVoice(text.slice(0, 600))
  try {
    const { samples, sampleRate } = await api('voice.speak', { text: text.slice(0, 600) })
    if (useVoice.getState().phase === 'listening') return
    const ctx = new AudioContext({ sampleRate })
    const buffer = ctx.createBuffer(1, samples.length, sampleRate)
    buffer.copyToChannel(new Float32Array(samples), 0)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    playing = { ctx, source }
    source.onended = () => {
      if (playing?.source === source) stopSpeaking()
    }
    setPhase('speaking')
    source.start()
  } catch {
    setPhase('idle')
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
      const clip = { ctx, stream, node, chunks: [] as Float32Array[], length: 0 }
      node.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0)
        clip.chunks.push(new Float32Array(data))
        clip.length += data.length
        let sum = 0
        for (let i = 0; i < data.length; i += 16) sum += data[i]! * data[i]!
        useVoice.setState({ level: Math.min(1, Math.sqrt(sum / (data.length / 16)) * 6) })
        if (clip.length >= CLIP_SAMPLE_RATE * MAX_CLIP_SECONDS) void queenVoice.stop()
      }
      // The node outputs silence; connecting it is what makes it run.
      source.connect(node)
      node.connect(ctx.destination)
      capture = clip
      setPhase('listening')
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
