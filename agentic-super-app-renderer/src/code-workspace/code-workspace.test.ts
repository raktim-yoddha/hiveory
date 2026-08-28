import { describe, it, expect } from 'vitest'
import {
  codeWorkspaceReducer,
  initialCodeWorkspaceState,
  type CodeWorkspaceState,
} from './state/code-workspace-reducer'
import type { CodePaneLayout, CodeTerminalSummary, CodePreviewSummary } from '../api/agentic-super-app-client'

describe('codeWorkspaceReducer', () => {
  const sampleLayout: CodePaneLayout = {
    workspace_id: 'ws_1',
    version: 2,
    root_id: 'root',
    nodes: [
      {
        pane_id: 'root',
        parent_id: null,
        kind: 'empty',
        orientation: null,
        ratio_percent: null,
        children: [],
        resource_id: null,
        title: null,
      },
    ],
    revision: 1,
    focused_pane_id: 'root',
    maximized_pane_id: null,
  }

  const sampleTerminal: CodeTerminalSummary = {
    id: 'term_1',
    workspace_id: 'ws_1',
    kind: 'shell',
    state: 'running',
    pid: 1234,
    adapter_id: null,
    session_id: null,
    exit_code: null,
    started_at_unix_ms: 1000,
    updated_at_unix_ms: 1000,
  }

  const samplePreview: CodePreviewSummary = {
    id: 'prev_1',
    workspace_id: 'ws_1',
    url: 'http://localhost:3000',
    origin: 'http://localhost:3000',
    state: 'open',
  }

  it('initializes workspace state with SET_WORKSPACE', () => {
    const next = codeWorkspaceReducer(initialCodeWorkspaceState, {
      type: 'SET_WORKSPACE',
      workspaceId: 'ws_1',
      layout: sampleLayout,
      terminals: [sampleTerminal],
      previews: [samplePreview],
    })

    expect(next.workspaceId).toBe('ws_1')
    expect(next.layout).toEqual(sampleLayout)
    expect(next.revision).toBe(1)
    expect(next.focusedPaneId).toBe('root')
    expect(next.maximizedPaneId).toBeNull()
    expect(next.terminals.get('term_1')).toEqual(sampleTerminal)
    expect(next.previews.get('prev_1')).toEqual(samplePreview)
    expect(next.error).toBeNull()
  })

  it('updates layout and tracks revision with SET_LAYOUT', () => {
    const updatedLayout: CodePaneLayout = {
      ...sampleLayout,
      revision: 2,
      focused_pane_id: 'pane_2',
    }

    const state: CodeWorkspaceState = {
      ...initialCodeWorkspaceState,
      workspaceId: 'ws_1',
      layout: sampleLayout,
      revision: 1,
    }

    const next = codeWorkspaceReducer(state, {
      type: 'SET_LAYOUT',
      layout: updatedLayout,
    })

    expect(next.layout).toEqual(updatedLayout)
    expect(next.revision).toBe(2)
    expect(next.focusedPaneId).toBe('pane_2')
  })

  it('updates focused pane with SET_FOCUSED_PANE', () => {
    const state: CodeWorkspaceState = {
      ...initialCodeWorkspaceState,
      focusedPaneId: 'pane_1',
    }

    const next = codeWorkspaceReducer(state, {
      type: 'SET_FOCUSED_PANE',
      paneId: 'pane_2',
    })

    expect(next.focusedPaneId).toBe('pane_2')
  })

  it('toggles maximized pane with SET_MAXIMIZED_PANE', () => {
    const state: CodeWorkspaceState = {
      ...initialCodeWorkspaceState,
      maximizedPaneId: null,
    }

    const next1 = codeWorkspaceReducer(state, {
      type: 'SET_MAXIMIZED_PANE',
      paneId: 'pane_1',
    })
    expect(next1.maximizedPaneId).toBe('pane_1')

    const next2 = codeWorkspaceReducer(next1, {
      type: 'SET_MAXIMIZED_PANE',
      paneId: null,
    })
    expect(next2.maximizedPaneId).toBeNull()
  })

  it('manages terminal insertion and removal', () => {
    const state = codeWorkspaceReducer(initialCodeWorkspaceState, {
      type: 'SET_TERMINAL',
      terminal: sampleTerminal,
    })
    expect(state.terminals.size).toBe(1)
    expect(state.terminals.get('term_1')).toEqual(sampleTerminal)

    const next = codeWorkspaceReducer(state, {
      type: 'REMOVE_TERMINAL',
      terminalId: 'term_1',
    })
    expect(next.terminals.size).toBe(0)
  })

  it('sets and clears confirm close dialog', () => {
    const state = codeWorkspaceReducer(initialCodeWorkspaceState, {
      type: 'SET_CONFIRM_CLOSE',
      confirm: {
        paneId: 'pane_1',
        title: 'Running Terminal',
        resourceId: 'term_1',
        isRunning: true,
      },
    })
    expect(state.confirmClosePane).not.toBeNull()
    expect(state.confirmClosePane?.paneId).toBe('pane_1')

    const next = codeWorkspaceReducer(state, {
      type: 'SET_CONFIRM_CLOSE',
      confirm: null,
    })
    expect(next.confirmClosePane).toBeNull()
  })
})
