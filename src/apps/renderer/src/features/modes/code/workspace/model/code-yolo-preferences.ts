import {
  ANTIGRAVITY_ADAPTER_ID,
  CLAUDE_CODE_ADAPTER_ID,
  CODEX_ADAPTER_ID,
  CURSOR_ADAPTER_ID,
  GROK_ADAPTER_ID,
  OPENCODE_ADAPTER_ID,
} from '../../../../../shared/api/hiveory-client'

export const YOLO_ADAPTER_IDS = [
  CODEX_ADAPTER_ID,
  CLAUDE_CODE_ADAPTER_ID,
  ANTIGRAVITY_ADAPTER_ID,
  OPENCODE_ADAPTER_ID,
  CURSOR_ADAPTER_ID,
  GROK_ADAPTER_ID,
] as const

export type YoloAdapterId = typeof YOLO_ADAPTER_IDS[number]
export type YoloPreferences = Record<YoloAdapterId, boolean>

const STORAGE_KEY = 'hiveory.code.yolo-preferences.v1'

const defaults = (): YoloPreferences => ({
  [CODEX_ADAPTER_ID]: false,
  [CLAUDE_CODE_ADAPTER_ID]: false,
  [ANTIGRAVITY_ADAPTER_ID]: false,
  [OPENCODE_ADAPTER_ID]: false,
  [CURSOR_ADAPTER_ID]: false,
  [GROK_ADAPTER_ID]: false,
})

export function supportsYoloLaunch(adapterId: string | undefined): adapterId is YoloAdapterId {
  return YOLO_ADAPTER_IDS.some((id) => id === adapterId)
}

export function loadYoloPreferences(): YoloPreferences {
  const fallback = defaults()
  if (typeof window === 'undefined') return fallback
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<YoloPreferences>
    for (const id of YOLO_ADAPTER_IDS) {
      fallback[id] = stored[id] === true
    }
  } catch {
    // Treat malformed old storage as a safe default instead of blocking pane creation.
  }
  return fallback
}

export function saveYoloPreferences(preferences: YoloPreferences): void {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences))
}
