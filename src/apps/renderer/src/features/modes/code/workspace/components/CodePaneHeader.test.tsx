import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import { CodePaneHeader } from './CodePaneHeader'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

vi.mock('@dnd-kit/core', () => ({
  useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: vi.fn(), setActivatorNodeRef: vi.fn(), isDragging: false }),
}))
vi.mock('../../../../global/browser/hooks/use-browser-surface-blocker', () => ({ useBrowserSurfaceBlocker: vi.fn() }))

let root: Root | null = null
let container: HTMLDivElement | null = null

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  container?.remove()
  container = null
})

test('shows every coding-agent lifecycle state with its semantic class', async () => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)

  const states = ['unknown', 'idle', 'starting', 'waiting', 'working', 'blocked', 'failed', 'exited', 'completed'] as const
  for (const state of states) {
    await act(async () => {
      root!.render(
        <CodePaneHeader
          node={{ pane_id: 'pane-a', parent_id: null, kind: 'coding_agent', orientation: null, ratio_percent: null, children: [], resource_id: 'terminal-a', title: 'Noodle' }}
          adapterId="codex-cli"
          isFocused={false}
          isMaximized={false}
          terminalState="running"
          agentStatus={{ session_id: 'session-a', workspace_id: 'workspace-a', terminal_id: 'terminal-a', pane_id: 'pane-a', run_id: null, task_id: null, participant_address: null, adapter_id: 'codex-cli', state, source: 'host', summary: 'Prompt delivered to coding-agent pane', sequence: 1, updated_at_unix_ms: 1 }}
          onFocus={() => undefined}
          onRename={async () => true}
          onSplitAndLaunch={() => undefined}
          onToggleMaximize={() => undefined}
          onClose={() => undefined}
        />,
      )
    })

    const status = container.querySelector('.code-pane-agent-status')
    const dot = container.querySelector('.code-live-dot')
    expect(status?.textContent).toBe(state)
    expect(status?.classList.contains(`is-${state}`)).toBe(true)
    expect(dot?.classList.contains(`is-${state}`)).toBe(true)
    expect(dot?.getAttribute('aria-label')).toContain(`${state}: Prompt delivered to coding-agent pane`)
  }
})
