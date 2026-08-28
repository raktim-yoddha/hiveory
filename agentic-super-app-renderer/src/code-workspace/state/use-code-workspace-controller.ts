import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  agenticSuperAppClient,
  type CodePaneMutation,
  type CodePanePlacement,
  type CodePanePreset,
  type CodeTerminalKind,
} from '../../api/agentic-super-app-client'
import {
  codeWorkspaceReducer,
  initialCodeWorkspaceState,
  type CodeWorkspaceState,
} from './code-workspace-reducer'

export interface CodeWorkspaceController {
  state: CodeWorkspaceState
  loadWorkspace: (workspaceId: string) => Promise<void>
  splitPane: (paneId: string, placement?: CodePanePlacement) => Promise<void>
  renamePane: (paneId: string, title: string) => Promise<void>
  movePane: (paneId: string, targetPaneId: string, placement: CodePanePlacement) => Promise<void>
  resizeSplit: (splitId: string, ratioPercent: number) => Promise<void>
  focusPane: (paneId: string) => Promise<void>
  toggleMaximize: (paneId?: string | null) => Promise<void>
  applyPreset: (preset: CodePanePreset) => Promise<void>
  launchTerminal: (paneId: string, kind: CodeTerminalKind, adapterId?: string | null, model?: string | null) => Promise<void>
  openPreview: (paneId: string, url: string) => Promise<void>
  createThread: (paneId: string) => Promise<void>
  requestClosePane: (paneId: string) => Promise<void>
  confirmClose: (terminateRunning: boolean) => Promise<void>
  dismissConfirmClose: () => void
  dismissError: () => void
  setError: (error: string | null) => void
}

export function useCodeWorkspaceController(initialWorkspaceId?: string | null): CodeWorkspaceController {
  const [state, dispatch] = useReducer(codeWorkspaceReducer, initialCodeWorkspaceState)
  const stateRef = useRef(state)
  stateRef.current = state

  const loadWorkspace = useCallback(async (workspaceId: string) => {
    try {
      dispatch({ type: 'SET_MUTATING', isMutating: true })
      const snapshot = await agenticSuperAppClient.codeWorkspace(workspaceId)
      dispatch({
        type: 'SET_WORKSPACE',
        workspaceId,
        layout: snapshot.layout,
        terminals: snapshot.terminals,
        previews: snapshot.previews,
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      dispatch({ type: 'SET_ERROR', error: `Failed to load workspace: ${msg}` })
    } finally {
      dispatch({ type: 'SET_MUTATING', isMutating: false })
    }
  }, [])

  useEffect(() => {
    if (initialWorkspaceId && initialWorkspaceId !== state.workspaceId) {
      void loadWorkspace(initialWorkspaceId)
    }
  }, [initialWorkspaceId, loadWorkspace, state.workspaceId])

  const applyMutation = useCallback(async (mutation: CodePaneMutation) => {
    const { workspaceId, revision } = stateRef.current
    if (!workspaceId) return
    try {
      dispatch({ type: 'SET_MUTATING', isMutating: true })
      const res = await agenticSuperAppClient.applyCodePaneMutation({
        workspace_id: workspaceId,
        expected_revision: revision,
        mutation,
      })
      dispatch({ type: 'SET_LAYOUT', layout: res.layout })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      if (msg.includes('layout_conflict')) {
        // Reload layout on concurrency conflict
        void loadWorkspace(workspaceId)
      } else {
        dispatch({ type: 'SET_ERROR', error: msg })
      }
    } finally {
      dispatch({ type: 'SET_MUTATING', isMutating: false })
    }
  }, [loadWorkspace])

  const splitPane = useCallback(
    async (paneId: string, placement: CodePanePlacement = 'right') => {
      await applyMutation({ type: 'split', pane_id: paneId, placement })
    },
    [applyMutation]
  )

  const renamePane = useCallback(
    async (paneId: string, title: string) => {
      const trimmed = title.trim()
      if (!trimmed) return
      await applyMutation({ type: 'rename', pane_id: paneId, title: trimmed })
    },
    [applyMutation]
  )

  const movePane = useCallback(
    async (paneId: string, targetPaneId: string, placement: CodePanePlacement) => {
      await applyMutation({ type: 'move', pane_id: paneId, target_pane_id: targetPaneId, placement })
    },
    [applyMutation]
  )

  const resizeSplit = useCallback(
    async (splitId: string, ratioPercent: number) => {
      await applyMutation({ type: 'resize', split_id: splitId, ratio_percent: ratioPercent })
    },
    [applyMutation]
  )

  const focusPane = useCallback(
    async (paneId: string) => {
      dispatch({ type: 'SET_FOCUSED_PANE', paneId })
      await applyMutation({ type: 'focus', pane_id: paneId })
    },
    [applyMutation]
  )

  const toggleMaximize = useCallback(
    async (paneId?: string | null) => {
      const currentMax = stateRef.current.maximizedPaneId
      const target = paneId !== undefined ? paneId : currentMax ? null : stateRef.current.focusedPaneId
      dispatch({ type: 'SET_MAXIMIZED_PANE', paneId: target })
      await applyMutation({ type: 'maximize', pane_id: target })
    },
    [applyMutation]
  )

  const applyPreset = useCallback(
    async (preset: CodePanePreset) => {
      await applyMutation({ type: 'apply_preset', preset })
    },
    [applyMutation]
  )

  const launchTerminal = useCallback(
    async (paneId: string, kind: CodeTerminalKind, adapterId?: string | null, model?: string | null) => {
      const { workspaceId, revision } = stateRef.current
      if (!workspaceId) return
      try {
        dispatch({ type: 'SET_MUTATING', isMutating: true })
        const res = await agenticSuperAppClient.launchCodePaneTerminal({
          workspace_id: workspaceId,
          pane_id: paneId,
          expected_revision: revision,
          kind,
          adapter_id: adapterId ?? null,
          model: model ?? null,
          cols: 80,
          rows: 24,
        })
        dispatch({ type: 'SET_TERMINAL', terminal: res.terminal })
        dispatch({ type: 'SET_LAYOUT', layout: res.layout })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: msg })
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
    },
    []
  )

  const openPreview = useCallback(
    async (paneId: string, url: string) => {
      const { workspaceId, revision } = stateRef.current
      if (!workspaceId) return
      try {
        dispatch({ type: 'SET_MUTATING', isMutating: true })
        const res = await agenticSuperAppClient.openCodePanePreview({
          workspace_id: workspaceId,
          pane_id: paneId,
          expected_revision: revision,
          url,
        })
        dispatch({ type: 'SET_PREVIEW', preview: res.preview })
        dispatch({ type: 'SET_LAYOUT', layout: res.layout })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: msg })
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
    },
    []
  )

  const createThread = useCallback(
    async (paneId: string) => {
      const { workspaceId, revision } = stateRef.current
      if (!workspaceId) return
      try {
        dispatch({ type: 'SET_MUTATING', isMutating: true })
        const res = await agenticSuperAppClient.createCodePaneThread({
          workspace_id: workspaceId,
          pane_id: paneId,
          expected_revision: revision,
        })
        dispatch({ type: 'SET_LAYOUT', layout: res.layout })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: msg })
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
    },
    []
  )

  const requestClosePane = useCallback(
    async (paneId: string) => {
      const { layout, terminals, workspaceId, revision } = stateRef.current
      if (!layout || !workspaceId) return

      const node = layout.nodes.find((n) => n.pane_id === paneId)
      if (!node) return

      let isRunning = false
      if (node.resource_id && (node.kind === 'terminal' || node.kind === 'coding_agent')) {
        const term = terminals.get(node.resource_id)
        if (term && (term.state === 'running' || term.state === 'starting')) {
          isRunning = true
        }
      }

      if (isRunning) {
        dispatch({
          type: 'SET_CONFIRM_CLOSE',
          confirm: {
            paneId,
            title: node.title || 'Terminal',
            resourceId: node.resource_id,
            isRunning: true,
          },
        })
        return
      }

      // Safe to close directly
      try {
        dispatch({ type: 'SET_MUTATING', isMutating: true })
        const res = await agenticSuperAppClient.closeCodePane({
          workspace_id: workspaceId,
          pane_id: paneId,
          expected_revision: revision,
          terminate_running_resource: false,
        })
        dispatch({ type: 'SET_LAYOUT', layout: res.layout })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: msg })
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
    },
    []
  )

  const confirmClose = useCallback(
    async (terminateRunning: boolean) => {
      const { confirmClosePane, workspaceId, revision } = stateRef.current
      if (!confirmClosePane || !workspaceId) return
      dispatch({ type: 'SET_CONFIRM_CLOSE', confirm: null })
      try {
        dispatch({ type: 'SET_MUTATING', isMutating: true })
        const res = await agenticSuperAppClient.closeCodePane({
          workspace_id: workspaceId,
          pane_id: confirmClosePane.paneId,
          expected_revision: revision,
          terminate_running_resource: terminateRunning,
        })
        dispatch({ type: 'SET_LAYOUT', layout: res.layout })
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        dispatch({ type: 'SET_ERROR', error: msg })
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
    },
    []
  )

  const dismissConfirmClose = useCallback(() => {
    dispatch({ type: 'SET_CONFIRM_CLOSE', confirm: null })
  }, [])

  const dismissError = useCallback(() => {
    dispatch({ type: 'SET_ERROR', error: null })
  }, [])

  const setError = useCallback((error: string | null) => {
    dispatch({ type: 'SET_ERROR', error })
  }, [])

  return {
    state,
    loadWorkspace,
    splitPane,
    renamePane,
    movePane,
    resizeSplit,
    focusPane,
    toggleMaximize,
    applyPreset,
    launchTerminal,
    openPreview,
    createThread,
    requestClosePane,
    confirmClose,
    dismissConfirmClose,
    dismissError,
    setError,
  }
}
