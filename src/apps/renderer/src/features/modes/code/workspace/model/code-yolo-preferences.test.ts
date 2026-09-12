import { afterEach, expect, test } from 'vitest'
import {
  loadYoloPreferences,
  saveYoloPreferences,
  supportsYoloLaunch,
} from './code-yolo-preferences'

afterEach(() => window.localStorage.clear())

test('persists a YOLO preference for each supported coding agent', () => {
  const preferences = loadYoloPreferences()
  expect(preferences['codex-cli']).toBe(false)
  expect(preferences['claude-code']).toBe(false)

  preferences['codex-cli'] = true
  preferences.opencode = true
  saveYoloPreferences(preferences)

  const reloaded = loadYoloPreferences()
  expect(reloaded['codex-cli']).toBe(true)
  expect(reloaded.opencode).toBe(true)
  expect(reloaded.antigravity).toBe(false)
})

test('exposes the YOLO switch only for supported coding agents', () => {
  expect(supportsYoloLaunch('codex-cli')).toBe(true)
  expect(supportsYoloLaunch('claude-code')).toBe(true)
  expect(supportsYoloLaunch('antigravity')).toBe(true)
  expect(supportsYoloLaunch('opencode')).toBe(true)
  expect(supportsYoloLaunch('terminal')).toBe(false)
})
