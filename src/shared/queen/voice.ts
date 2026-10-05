/**
 * Queen Bee's local voice (ADR 0019, phase 3): speech packs the user downloads on
 * purpose. Every file is pinned to a fixed commit and checked against its SHA-256
 * before use; nothing here ever runs in the cloud.
 */

export type VoicePackId = 'parakeet' | 'whisper' | 'kokoro'

export interface VoiceFile {
  /** Where it lands inside the pack's folder. */
  path: string
  url: string
  sha256: string
  size: number
  /** Archives are unpacked into the pack folder after verification. */
  extract?: boolean
}

export interface VoicePack {
  id: VoicePackId
  kind: 'listen' | 'speak'
  name: string
  description: string
  languages: string
  license: string
  files: VoiceFile[]
}

const HF = 'https://huggingface.co/csukuangfj'
const PARAKEET = `${HF}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78`
const WHISPER = `${HF}/sherpa-onnx-whisper-turbo/resolve/2ca6ff69fc878651b770880507669577ac41c2ff`
const KOKORO = `${HF}/kokoro-multi-lang-v1_0/resolve/f7b96bb6bef5c5da4d3aa4f4e0498fbbf62dc78b`

export const VOICE_PACKS: VoicePack[] = [
  {
    id: 'parakeet',
    kind: 'listen',
    name: 'Parakeet',
    description: 'Fast, accurate speech recognition on your CPU (NVIDIA Parakeet TDT 0.6B v3).',
    languages: 'English, Spanish, Portuguese, German, French and 20 more European languages',
    license: 'CC-BY-4.0',
    files: [
      { path: 'encoder.int8.onnx', url: `${PARAKEET}/encoder.int8.onnx`, sha256: 'acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247', size: 652184281 },
      { path: 'decoder.int8.onnx', url: `${PARAKEET}/decoder.int8.onnx`, sha256: '179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e', size: 11845275 },
      { path: 'joiner.int8.onnx', url: `${PARAKEET}/joiner.int8.onnx`, sha256: '3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3', size: 6355277 },
      { path: 'tokens.txt', url: `${PARAKEET}/tokens.txt`, sha256: 'd58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d', size: 93939 }
    ]
  },
  {
    id: 'whisper',
    kind: 'listen',
    name: 'Whisper Turbo',
    description: 'For Hindi and Hinglish: writes what you say in English letters (“do codex kholo”), which Queen Bee understands. Slower than Parakeet.',
    languages: 'Also hears 90+ other languages',
    license: 'MIT',
    files: [
      { path: 'turbo-encoder.int8.onnx', url: `${WHISPER}/turbo-encoder.int8.onnx`, sha256: 'b02dcdf54f348741e93fe732b67d933c8dcb6735655f710640143081db38878b', size: 674716297 },
      { path: 'turbo-decoder.int8.onnx', url: `${WHISPER}/turbo-decoder.int8.onnx`, sha256: '20accd02388482eb3a46bd615631adfdc85e1eb2c7db9ea3f02a40ffe6b81547', size: 361080764 },
      { path: 'turbo-tokens.txt', url: `${WHISPER}/turbo-tokens.txt`, sha256: 'b34b360dbb493e781e479794586d661700670d65564001f23024971d1f2fa126', size: 816730 }
    ]
  },
  {
    id: 'kokoro',
    kind: 'speak',
    name: 'Kokoro',
    description: 'Natural voices for Queen Bee’s replies (Kokoro 82M), on your CPU.',
    languages: 'English (US and UK voices)',
    license: 'Apache-2.0',
    files: [
      { path: 'model.onnx', url: `${KOKORO}/model.onnx`, sha256: 'b40f62b166ac8164b0627ef48a0b358eda0985e272fb03ef5252e7206305da11', size: 325560556 },
      { path: 'voices.bin', url: `${KOKORO}/voices.bin`, sha256: '1c5a5b983d3d50d8586d437a51f3faa2da7919ce76a013c081e65671a3447c29', size: 28200960 },
      { path: 'tokens.txt', url: `${KOKORO}/tokens.txt`, sha256: '6ebb6bb288f20f3ae8d004d3c2ca27697da27c037d75e81a60e2a6a663f95425', size: 687 },
      { path: 'lexicon-us-en.txt', url: `${KOKORO}/lexicon-us-en.txt`, sha256: '7daaab53a181be9885b853a8582bf1838186317e5dadacbcef9c426d6fa0da14', size: 5956885 },
      { path: 'lexicon-gb-en.txt', url: `${KOKORO}/lexicon-gb-en.txt`, sha256: 'c4cbb37316f62210dff52718a7afcaae24f50c032cc75ab47ae67b831d1049e7', size: 6366635 },
      {
        path: 'espeak-ng-data.tar.bz2',
        url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/espeak-ng-data.tar.bz2',
        sha256: '4135ccf82e1f40613491c0874d4945ae9e9c7840933d8e25a6f9e003d9ebf533',
        size: 7252012,
        extract: true
      }
    ]
  }
]

export const packSize = (pack: VoicePack): number => pack.files.reduce((n, f) => n + f.size, 0)

/** Languages Queen Bee listens in, and which pack hears each. */
export const SPEECH_LANGUAGES = [
  { id: 'en', name: 'English', pack: 'parakeet' },
  { id: 'es', name: 'Spanish', pack: 'parakeet' },
  { id: 'pt', name: 'Portuguese', pack: 'parakeet' },
  { id: 'de', name: 'German', pack: 'parakeet' },
  { id: 'fr', name: 'French', pack: 'parakeet' },
  { id: 'hi', name: 'Hindi / Hinglish', pack: 'whisper' }
] as const satisfies ReadonlyArray<{ id: string; name: string; pack: VoicePackId }>

export type SpeechLanguage = (typeof SPEECH_LANGUAGES)[number]['id']

/**
 * Kokoro v1.0's English speakers, by speaker id (the model's alphabetical order:
 * American women, American men, British women, British men). Replies are English,
 * so only these are offered.
 */
const VOICE_NAMES: Array<[string, string]> = [
  ['Alloy', 'American'], ['Aoede', 'American'], ['Bella', 'American'], ['Heart', 'American'], ['Jessica', 'American'], ['Kore', 'American'],
  ['Nicole', 'American'], ['Nova', 'American'], ['River', 'American'], ['Sarah', 'American'], ['Sky', 'American'],
  ['Adam', 'American, male'], ['Echo', 'American, male'], ['Eric', 'American, male'], ['Fenrir', 'American, male'], ['Liam', 'American, male'],
  ['Michael', 'American, male'], ['Onyx', 'American, male'], ['Puck', 'American, male'], ['Santa', 'American, male'],
  ['Alice', 'British'], ['Emma', 'British'], ['Isabella', 'British'], ['Lily', 'British'],
  ['Daniel', 'British, male'], ['Fable', 'British, male'], ['George', 'British, male'], ['Lewis', 'British, male']
]
export const KOKORO_VOICES: Array<{ sid: number; name: string }> = VOICE_NAMES.map(([name, accent], sid) => ({ sid, name: `${name} (${accent})` }))

/** Each personality's own voice: formal British for Ada, bright for Sunny, direct for Frankie, warm for a custom one. */
export const PERSONA_VOICES: Record<'ada' | 'sunny' | 'frankie' | 'custom', { sid: number; name: string }> = {
  ada: KOKORO_VOICES[21]!,
  sunny: KOKORO_VOICES[2]!,
  frankie: KOKORO_VOICES[9]!,
  custom: KOKORO_VOICES[3]!
}

/** The voice she speaks with: the one picked in Settings, or her personality's own. */
export const voiceFor = (s: { queenPersona: keyof typeof PERSONA_VOICES; queenVoice: number }): { sid: number; name: string } =>
  KOKORO_VOICES[s.queenVoice] ?? PERSONA_VOICES[s.queenPersona]

export type VoicePackState =
  | { id: VoicePackId; state: 'missing' }
  | { id: VoicePackId; state: 'downloading'; received: number; total: number }
  | { id: VoicePackId; state: 'verifying' }
  | { id: VoicePackId; state: 'ready' }
  | { id: VoicePackId; state: 'error'; error: string }

/** Longest push-to-talk clip Queen Bee accepts (16 kHz mono). */
export const MAX_CLIP_SECONDS = 60
export const CLIP_SAMPLE_RATE = 16000
