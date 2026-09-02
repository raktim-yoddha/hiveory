import type {
  CodePaneLayout,
  CodeTerminalSummary,
  CodePreviewSummary,
} from '../../../shared/api/hiveory-client'

export interface CodeWorkspaceState {
  workspaceId: string | null
  layout: CodePaneLayout | null
  revision: number
  focusedPaneId: string | null
  maximizedPaneId: string | null
  terminals: Map<string, CodeTerminalSummary>
  previews: Map<string, CodePreviewSummary>
  isMutating: boolean
  error: string | null
  confirmClosePane: {
    paneId: string
    title: string
    resourceId: string | null
    isRunning: boolean
  } | null
}

export type CodeWorkspaceAction =
  | { type: 'SET_WORKSPACE_LOADING'; workspaceId: string }
  | { type: 'CLEAR_WORKSPACE' }
  | { type: 'SET_WORKSPACE'; workspaceId: string; layout: CodePaneLayout; terminals: CodeTerminalSummary[]; previews: CodePreviewSummary[] }
  | { type: 'SET_LAYOUT'; layout: CodePaneLayout }
  | { type: 'SET_FOCUSED_PANE'; paneId: string }
  | { type: 'SET_MAXIMIZED_PANE'; paneId: string | null }
  | { type: 'SET_TERMINAL'; terminal: CodeTerminalSummary }
  | { type: 'REMOVE_TERMINAL'; terminalId: string }
  | { type: 'SET_PREVIEW'; preview: CodePreviewSummary }
  | { type: 'SET_CONFIRM_CLOSE'; confirm: CodeWorkspaceState['confirmClosePane'] }
  | { type: 'SET_MUTATING'; isMutating: boolean }
  | { type: 'SET_ERROR'; error: string | null }

export const initialCodeWorkspaceState: CodeWorkspaceState = {
  workspaceId: null,
  layout: null,
  revision: 0,
  focusedPaneId: null,
  maximizedPaneId: null,
  terminals: new Map(),
  previews: new Map(),
  isMutating: false,
  error: null,
  confirmClosePane: null,
}

export function codeWorkspaceReducer(
  state: CodeWorkspaceState,
  action: CodeWorkspaceAction
): CodeWorkspaceState {
  switch (action.type) {
    case 'SET_WORKSPACE_LOADING':
      return {
        ...state,
        workspaceId: action.workspaceId,
        layout: null,
        revision: 0,
        focusedPaneId: null,
        maximizedPaneId: null,
        terminals: new Map(),
        previews: new Map(),
        error: null,
      }
    case 'CLEAR_WORKSPACE':
      return {
        ...state,
        workspaceId: null,
        layout: null,
        revision: 0,
        focusedPaneId: null,
        maximizedPaneId: null,
        terminals: new Map(),
        previews: new Map(),
        isMutating: false,
        error: null,
        confirmClosePane: null,
      }
    case 'SET_WORKSPACE': {
      const termMap = new Map<string, CodeTerminalSummary>()
      action.terminals.forEach((t) => termMap.set(t.id, t))
      const prevMap = new Map<string, CodePreviewSummary>()
      action.previews.forEach((p) => prevMap.set(p.id, p))

      return {
        ...state,
        workspaceId: action.workspaceId,
        layout: action.layout,
        revision: action.layout.revision ?? 0,
        focusedPaneId: action.layout.focused_pane_id ?? action.layout.nodes.find((n) => n.children.length === 0)?.pane_id ?? null,
        maximizedPaneId: action.layout.maximized_pane_id ?? null,
        terminals: termMap,
        previews: prevMap,
        error: null,
      }
    }
    case 'SET_LAYOUT': {
      return {
        ...state,
        layout: action.layout,
        revision: action.layout.revision ?? state.revision + 1,
        focusedPaneId: action.layout.focused_pane_id ?? state.focusedPaneId,
        maximizedPaneId: action.layout.maximized_pane_id ?? null,
        error: null,
      }
    }
    case 'SET_FOCUSED_PANE': {
      if (state.focusedPaneId === action.paneId) return state
      return {
        ...state,
        focusedPaneId: action.paneId,
      }
    }
    case 'SET_MAXIMIZED_PANE': {
      return {
        ...state,
        maximizedPaneId: action.paneId,
      }
    }
    case 'SET_TERMINAL': {
      const termMap = new Map(state.terminals)
      termMap.set(action.terminal.id, action.terminal)
      return {
        ...state,
        terminals: termMap,
      }
    }
    case 'REMOVE_TERMINAL': {
      const termMap = new Map(state.terminals)
      termMap.delete(action.terminalId)
      return {
        ...state,
        terminals: termMap,
      }
    }
    case 'SET_PREVIEW': {
      const prevMap = new Map(state.previews)
      prevMap.set(action.preview.id, action.preview)
      return {
        ...state,
        previews: prevMap,
      }
    }
    case 'SET_CONFIRM_CLOSE': {
      return {
        ...state,
        confirmClosePane: action.confirm,
      }
    }
    case 'SET_MUTATING': {
      return {
        ...state,
        isMutating: action.isMutating,
      }
    }
    case 'SET_ERROR': {
      return {
        ...state,
        error: action.error,
      }
    }
    default:
      return state
  }
}
