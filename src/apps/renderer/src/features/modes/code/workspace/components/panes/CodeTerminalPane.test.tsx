import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { CodeWorkspaceActivityContext } from '../../state/code-workspace-activity'
import { CodeTerminalPane } from './CodeTerminalPane'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const testState = vi.hoisted(() => {
  const terminals: Array<{
    cols: number
    rows: number
    refresh: ReturnType<typeof vi.fn>
    clearTextureAtlas: ReturnType<typeof vi.fn>
    onScrollCallback: (() => void) | null
  }> = []
  class FakeTerminal {
    cols = 80
    rows = 24
    refresh = vi.fn()
    clearTextureAtlas = vi.fn()
    write = vi.fn()
    writeln = vi.fn()
    paste = vi.fn()
    input = vi.fn()
    loadAddon = vi.fn()
    open = vi.fn()
    dispose = vi.fn()
    onScrollCallback: (() => void) | null = null

    constructor() {
      terminals.push(this)
    }

    onData = vi.fn(() => ({ dispose: vi.fn() }))
    onScroll = vi.fn((callback: () => void) => {
      this.onScrollCallback = callback
      return { dispose: vi.fn() }
    })
    attachCustomKeyEventHandler = vi.fn()
    hasSelection = vi.fn(() => false)
    getSelection = vi.fn(() => '')
    selectAll = vi.fn()
  }
  const client = {
    getCodeTerminalSnapshot: vi.fn(async () => ({ output_base64: '', sequence: 0 })),
    subscribeCodeTerminalEvents: vi.fn(() => () => undefined),
    resizeCodeTerminal: vi.fn(async () => true),
    writeCodeTerminal: vi.fn(async () => true),
  }
  return { terminals, client, FakeTerminal }
})

vi.mock('@xterm/xterm', () => ({ Terminal: testState.FakeTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn() } }))
vi.mock('../../../../../../shared/api/hiveory-client', () => ({ hiveoryClient: testState.client }))
vi.mock('../../../../../../shared/clipboard', () => ({ readClipboardText: vi.fn(), writeClipboardText: vi.fn() }))
vi.mock('../../../../../../shared/speech-dictation', () => ({
  useSpeechDictation: () => ({ supported: false, listening: false, toggle: vi.fn(), stop: vi.fn(), partialText: '' }),
}))

let root: Root | null = null
let container: HTMLDivElement | null = null
let restoreBounds: (() => void) | null = null
let restoreFrame: (() => void) | null = null

beforeEach(() => {
  testState.terminals.length = 0
  vi.clearAllMocks()
  const bounds = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width: 640,
    height: 360,
    top: 0,
    left: 0,
    right: 640,
    bottom: 360,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  }) as DOMRect)
  restoreBounds = () => bounds.mockRestore()
  const requestFrame = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    callback(0)
    return null as unknown as number
  })
  const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined)
  restoreFrame = () => {
    requestFrame.mockRestore()
    cancelFrame.mockRestore()
  }
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
  restoreBounds?.()
  restoreBounds = null
  restoreFrame?.()
  restoreFrame = null
})

async function render(active: boolean, terminalId = 'terminal-a', adapterId = 'codex-cli') {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  await act(async () => {
    root!.render(
      <CodeWorkspaceActivityContext.Provider value={active}>
        <CodeTerminalPane terminalId={terminalId} summary={{
          id: terminalId,
          workspace_id: 'workspace-a',
          kind: 'coding_agent',
          state: 'running',
          pid: 1,
          adapter_id: adapterId,
          model: null,
          reasoning_effort: null,
          agent_launch_mode: 'standard',
          session_id: 'session-a',
          exit_code: null,
          started_at_unix_ms: 0,
          updated_at_unix_ms: 0,
        }} />
      </CodeWorkspaceActivityContext.Provider>,
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}

test('keeps every terminal mounted and redraws it after scroll, Code return, and window restore', async () => {
  await render(true)
  const terminal = testState.terminals[0]
  expect(terminal).toBeDefined()
  expect(testState.client.getCodeTerminalSnapshot).toHaveBeenCalledWith('terminal-a')
  expect(testState.client.resizeCodeTerminal).toHaveBeenCalledWith({ terminal_id: 'terminal-a', cols: 80, rows: 24 })

  const resizeCount = testState.client.resizeCodeTerminal.mock.calls.length
  terminal.onScrollCallback?.()
  expect(terminal.clearTextureAtlas).toHaveBeenCalled()
  expect(terminal.refresh).toHaveBeenCalled()
  expect(testState.client.resizeCodeTerminal).toHaveBeenCalledTimes(resizeCount)

  await render(false)
  const refreshBeforeCodeReturn = terminal.refresh.mock.calls.length
  await render(true)
  expect(testState.terminals).toHaveLength(1)
  expect(terminal.refresh.mock.calls.length).toBeGreaterThan(refreshBeforeCodeReturn)

  const refreshCount = terminal.refresh.mock.calls.length
  window.dispatchEvent(new Event('focus'))
  document.dispatchEvent(new Event('visibilitychange'))
  expect(terminal.refresh.mock.calls.length).toBeGreaterThan(refreshCount)
  expect(testState.client.resizeCodeTerminal).toHaveBeenCalledTimes(resizeCount)
})

test('keeps the redraw lifecycle adapter-neutral for every supported coding CLI', async () => {
  for (const adapterId of ['codex-cli', 'claude-code', 'antigravity', 'opencode', 'cursor', 'grok']) {
    const terminalId = `terminal-${adapterId}`
    await render(true, terminalId, adapterId)
    const terminal = testState.terminals.at(-1)
    expect(terminal).toBeDefined()
    expect(testState.client.getCodeTerminalSnapshot).toHaveBeenCalledWith(terminalId)

    const resizeCount = testState.client.resizeCodeTerminal.mock.calls.length
    terminal!.onScrollCallback?.()
    expect(terminal!.clearTextureAtlas).toHaveBeenCalled()
    expect(terminal!.refresh).toHaveBeenCalled()
    expect(testState.client.resizeCodeTerminal).toHaveBeenCalledTimes(resizeCount)

    await render(false, terminalId, adapterId)
    const refreshBeforeCodeReturn = terminal!.refresh.mock.calls.length
    await render(true, terminalId, adapterId)
    expect(terminal!.refresh.mock.calls.length).toBeGreaterThan(refreshBeforeCodeReturn)

    await act(async () => root!.unmount())
    root = null
    container?.remove()
    container = null
  }
})
