import { useCallback, useEffect, useRef, useState } from 'react'

type SpeechRecognitionAlternativeLike = { transcript: string }

type SpeechRecognitionResultLike = {
  isFinal: boolean
  length: number
  [index: number]: SpeechRecognitionAlternativeLike
}

type SpeechRecognitionResultListLike = {
  length: number
  [index: number]: SpeechRecognitionResultLike
}

type SpeechRecognitionEventLike = Event & {
  resultIndex: number
  results: SpeechRecognitionResultListLike
}

type SpeechRecognitionErrorEventLike = Event & {
  error?: string
  message?: string
}

type SpeechRecognitionLike = {
  continuous: boolean
  interimResults: boolean
  lang: string
  onend: (() => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor
  webkitSpeechRecognition?: SpeechRecognitionConstructor
}

export type SpeechDictationOptions = {
  language?: string
  onFinalText: (text: string) => void
  onPartialText?: (text: string) => void
  onError?: (message: string) => void
}

export type SpeechDictationState = {
  supported: boolean
  listening: boolean
  partialText: string
  start: () => void
  stop: () => void
  toggle: () => void
}

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  const speechWindow = window as SpeechRecognitionWindow
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null
}

function normalizeSpeechError(event: SpeechRecognitionErrorEventLike): string {
  switch (event.error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Microphone permission was denied. Allow microphone access and try again.'
    case 'audio-capture':
      return 'No microphone could be opened. Check the Windows input device and try again.'
    case 'network':
      return 'Speech recognition needs a network connection in this browser runtime.'
    case 'no-speech':
      return 'No speech was detected.'
    default:
      return event.message || event.error || 'Speech recognition could not start.'
  }
}

/**
 * Small renderer-side dictation adapter shared by Agent Mode and terminal panes.
 * WebView2 exposes the same SpeechRecognition surface as Chromium on supported
 * Windows builds. The hook keeps recognition lifecycle local to the focused pane
 * and never sends microphone audio anywhere from Hiveory itself.
 */
export function useSpeechDictation({
  language = 'en-US',
  onFinalText,
  onPartialText,
  onError,
}: SpeechDictationOptions): SpeechDictationState {
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const shouldListenRef = useRef(false)
  const restartTimerRef = useRef<number | null>(null)
  const deliveredFinalIndexesRef = useRef(new Set<number>())
  const [listening, setListening] = useState(false)
  const [partialText, setPartialText] = useState('')
  const supported = getSpeechRecognition() !== null

  const clearPartial = useCallback(() => {
    setPartialText('')
    onPartialText?.('')
  }, [onPartialText])

  const stop = useCallback(() => {
    shouldListenRef.current = false
    if (restartTimerRef.current !== null) {
      window.clearTimeout(restartTimerRef.current)
      restartTimerRef.current = null
    }
    try {
      recognitionRef.current?.stop()
    } catch {
      recognitionRef.current?.abort()
    }
    recognitionRef.current = null
    setListening(false)
    clearPartial()
  }, [clearPartial])

  const start = useCallback(() => {
    if (shouldListenRef.current) return
    const SpeechRecognition = getSpeechRecognition()
    if (!SpeechRecognition) {
      onError?.('Speech recognition is unavailable in this WebView runtime.')
      return
    }

    const recognition = new SpeechRecognition()
    deliveredFinalIndexesRef.current.clear()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = language
    recognition.onresult = (event) => {
      let interim = ''
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index]
        const text = result?.[0]?.transcript?.trim() ?? ''
        if (!text) continue
        if (result.isFinal) {
          // Some WebView speech implementations replay final results during a
          // continuous session. A final result index is immutable, so deliver
          // each one once and keep dictated text from being repeated.
          if (deliveredFinalIndexesRef.current.has(index)) continue
          deliveredFinalIndexesRef.current.add(index)
          onFinalText(text)
        }
        else interim += `${text} `
      }
      const nextPartial = interim.trim()
      setPartialText(nextPartial)
      onPartialText?.(nextPartial)
    }
    recognition.onerror = (event) => {
      const message = normalizeSpeechError(event)
      if (event.error !== 'no-speech') onError?.(message)
      if (event.error === 'not-allowed' || event.error === 'service-not-allowed' || event.error === 'audio-capture') {
        shouldListenRef.current = false
        setListening(false)
      }
    }
    recognition.onend = () => {
      if (!shouldListenRef.current) {
        setListening(false)
        return
      }
      // WebView2 can end a continuous recognition session after a period of
      // silence. Restart it while the user still has dictation enabled.
      restartTimerRef.current = window.setTimeout(() => {
        restartTimerRef.current = null
        deliveredFinalIndexesRef.current.clear()
        try {
          recognition.start()
        } catch {
          shouldListenRef.current = false
          setListening(false)
          onError?.('Speech recognition stopped unexpectedly.')
        }
      }, 120)
    }

    shouldListenRef.current = true
    recognitionRef.current = recognition
    clearPartial()
    try {
      recognition.start()
      setListening(true)
    } catch {
      shouldListenRef.current = false
      recognitionRef.current = null
      setListening(false)
      onError?.('Speech recognition could not start. Check the microphone permission.')
    }
  }, [clearPartial, language, onError, onFinalText, onPartialText])

  const toggle = useCallback(() => {
    if (shouldListenRef.current) stop()
    else start()
  }, [start, stop])

  useEffect(() => () => stop(), [stop])

  return { supported, listening, partialText, start, stop, toggle }
}
