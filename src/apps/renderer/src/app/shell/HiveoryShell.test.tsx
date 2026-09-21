import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { HiveoryDialogProvider } from '../../shared/ui/HiveoryDesign'
import { HiveoryShell } from './HiveoryShell'
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const testState = vi.hoisted(() => {
  const mounts = { code: 0, codeUnmounts: 0 }
  const client = {
    bootstrap: vi.fn(async () => ({ protocol: { major: 2 }, active_mode: 'code', product_name: 'Hiveory' })),
    diagnostics: vi.fn(async () => ({ providers: [], recent_jobs: [], notifications: [], recovery_message: null })),
    subscribe: vi.fn(() => () => undefined),
    setActiveMode: vi.fn(async (mode: 'agent' | 'code' | 'chat') => ({ protocol: { major: 2 }, active_mode: mode, product_name: 'Hiveory' })),
    checkForUpdate: vi.fn(async () => ({ configured: false, current_version: '0.2.2', available_version: null, notes: null, published_at: null, status: 'not_configured' })),
  }
  return { mounts, client }
})

vi.mock('../../shared/api/hiveory-client', () => ({
  hiveoryClient: testState.client,
  formatHiveoryClientError: (error: unknown) => error instanceof Error ? error.message : String(error),
}))

vi.mock('../../features/modes/code/workspace/views/HiveoryCodeWorkspace', () => ({
  HiveoryCodeWorkspace: ({ active = true }: { active?: boolean }) => {
    useEffect(() => {
      testState.mounts.code += 1
      return () => {
        testState.mounts.codeUnmounts += 1
      }
    }, [])
    return <div data-testid="test-code-surface" data-active={String(active)} />
  },
}))

vi.mock('../../features/modes/chat/views/HiveoryChat', () => ({
  HiveoryChat: () => <div data-testid="test-chat-surface" />,
}))

let root: Root | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.innerHTML = ''
  testState.mounts.code = 0
  testState.mounts.codeUnmounts = 0
  vi.clearAllMocks()
})

test('keeps the Code surface mounted while switching Chat and Code modes', async () => {
  const container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  await act(async () => {
    root!.render(
      <HiveoryDialogProvider>
        <HiveoryShell />
      </HiveoryDialogProvider>,
    )
    await Promise.resolve()
    await Promise.resolve()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
  })

  const codeSurface = container.querySelector('[data-testid="test-code-surface"]')
  expect(codeSurface).not.toBeNull()
  expect(codeSurface?.getAttribute('data-active')).toBe('true')
  expect(testState.mounts.code).toBe(1)

  const modeButtons = () => Array.from(container.querySelectorAll<HTMLButtonElement>('.hiveory-mode-switch button'))
  const chatButton = modeButtons().find((button) => button.textContent === 'Chat')
  expect(chatButton).not.toBeUndefined()

  await act(async () => {
    chatButton!.click()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    await Promise.resolve()
  })

  expect(container.querySelector('[data-testid="test-chat-surface"]')).not.toBeNull()
  expect(container.querySelector('[data-testid="test-code-surface"]')).toBe(codeSurface)
  expect(codeSurface?.getAttribute('data-active')).toBe('false')
  expect(testState.mounts.code).toBe(1)
  expect(testState.mounts.codeUnmounts).toBe(0)

  const codeButton = modeButtons().find((button) => button.textContent === 'Code')
  expect(codeButton).not.toBeUndefined()

  await act(async () => {
    codeButton!.click()
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
    await Promise.resolve()
  })

  expect(container.querySelector('[data-testid="test-code-surface"]')).toBe(codeSurface)
  expect(codeSurface?.getAttribute('data-active')).toBe('true')
  expect(testState.mounts.code).toBe(1)
  expect(testState.mounts.codeUnmounts).toBe(0)
})
