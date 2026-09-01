import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  hiveoryClient,
  type CodePaneMutation,
  type CodePanePlacement,
  type CodePanePreset,
  type CodeTerminalKind,
} from '../../../shared/api/hiveory-client'
import {
  codeWorkspaceReducer,
  initialCodeWorkspaceState,
  type CodeWorkspaceState,
} from './code-workspace-reducer'

export interface CodeWorkspaceController {
  state: CodeWorkspaceState
  loadWorkspace: (workspaceId: string) => Promise<void>
  splitPane: (paneId: string, placement?: CodePanePlacement) => Promise<void>
  splitAndLaunch: (
    paneId: string,
    placement: CodePanePlacement,
    kind: 'shell' | 'coding_agent' | 'markdown' | 'preview',
    adapterId?: string | null,
    model?: string | null,
    url?: string
  ) => Promise<void>
  renamePane: (paneId: string, title: string) => Promise<void>
  movePane: (paneId: string, targetPaneId: string, placement: CodePanePlacement) => Promise<void>
  resizeSplit: (splitId: string, ratioPercent: number) => Promise<void>
  focusPane: (paneId: string) => Promise<void>
  toggleMaximize: (paneId?: string | null) => Promise<void>
  applyPreset: (preset: CodePanePreset, primaryPaneId?: string | null) => Promise<void>
  launchTerminal: (paneId: string, kind: CodeTerminalKind, adapterId?: string | null, model?: string | null) => Promise<void>
  openPreview: (paneId: string, url: string) => Promise<void>
  createMarkdown: (paneId: string) => Promise<void>
  sleepWorkspace: (workspaceId?: string) => Promise<boolean>
  requestClosePane: (paneId: string) => Promise<void>
  confirmClose: (terminateRunning: boolean) => Promise<void>
  dismissConfirmClose: () => void
  dismissError: () => void
  setError: (error: string | null) => void
}

function formatError(err: unknown): string {
  if (!err) return 'Unknown error'
  if (typeof err === 'string') return err
  if (err instanceof Error) return err.message
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>
    if (typeof obj.message === 'string') return obj.message
    if (typeof obj.error === 'string') return obj.error
    try {
      return JSON.stringify(err)
    } catch {
      return String(err)
    }
  }
  return String(err)
}

export function useCodeWorkspaceController(initialWorkspaceId?: string | null): CodeWorkspaceController {
  const [state, dispatch] = useReducer(codeWorkspaceReducer, initialCodeWorkspaceState)
  const stateRef = useRef(state)
  const mutationQueueRef = useRef<Promise<void>>(Promise.resolve())
  const loadRequestRef = useRef(0)
  stateRef.current = state

  const loadWorkspace = useCallback(async (workspaceId: string) => {
    const requestId = ++loadRequestRef.current
    dispatch({ type: 'SET_WORKSPACE_LOADING', workspaceId })
    try {
      dispatch({ type: 'SET_MUTATING', isMutating: true })
      const snapshot = await hiveoryClient.codeWorkspace(workspaceId)
      if (requestId !== loadRequestRef.current) return
      dispatch({
        type: 'SET_WORKSPACE',
        workspaceId,
        layout: snapshot.layout,
        terminals: snapshot.terminals,
        previews: snapshot.previews,
      })
      stateRef.current = {
        ...stateRef.current,
        workspaceId,
        layout: snapshot.layout,
        revision: snapshot.layout.revision ?? 0,
        focusedPaneId: snapshot.layout.focused_pane_id ?? null,
        maximizedPaneId: snapshot.layout.maximized_pane_id ?? null,
      }
    } catch (err: unknown) {
      if (requestId !== loadRequestRef.current) return
      dispatch({ type: 'SET_ERROR', error: `Failed to load workspace: ${formatError(err)}` })
    } finally {
      if (requestId === loadRequestRef.current) {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
    }
  }, [])

  useEffect(() => {
    if (initialWorkspaceId && initialWorkspaceId !== state.workspaceId) {
      void loadWorkspace(initialWorkspaceId)
    }
  }, [initialWorkspaceId, loadWorkspace, state.workspaceId])

  useEffect(() => {
    const handleLayoutUpdated = (event: Event) => {
      const layout = (event as CustomEvent<CodeWorkspaceState['layout']>).detail
      if (!layout || layout.workspace_id !== stateRef.current.workspaceId) return
      stateRef.current = { ...stateRef.current, layout, revision: layout.revision ?? stateRef.current.revision }
      dispatch({ type: 'SET_LAYOUT', layout })
    }
    window.addEventListener('hiveory-code-layout-updated', handleLayoutUpdated)
    return () => window.removeEventListener('hiveory-code-layout-updated', handleLayoutUpdated)
  }, [])

  const applyMutation = useCallback((mutation: CodePaneMutation) => {
    const run = mutationQueueRef.current.then(async () => {
      const { workspaceId, revision } = stateRef.current
      if (!workspaceId) return
      try {
        dispatch({ type: 'SET_MUTATING', isMutating: true })
        const res = await hiveoryClient.applyCodePaneMutation({
          workspace_id: workspaceId,
          expected_revision: revision,
          mutation,
        })
        stateRef.current = {
          ...stateRef.current,
          layout: res.layout,
          revision: res.layout.revision ?? revision + 1,
          focusedPaneId: res.layout.focused_pane_id ?? stateRef.current.focusedPaneId,
          maximizedPaneId: res.layout.maximized_pane_id ?? null,
        }
        dispatch({ type: 'SET_LAYOUT', layout: res.layout })
      } catch (err: unknown) {
        const msg = formatError(err)
        if (msg.includes('layout_conflict')) {
          await loadWorkspace(workspaceId)
        } else {
          dispatch({ type: 'SET_ERROR', error: msg })
        }
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
    })
    mutationQueueRef.current = run.catch(() => undefined)
    return run
  }, [loadWorkspace])

  const splitPane = useCallback(
    async (paneId: string, placement: CodePanePlacement = 'right') => {
      await applyMutation({ type: 'split', pane_id: paneId, placement })
    },
    [applyMutation]
  )

  const splitAndLaunch = useCallback(
    async (
      paneId: string,
      placement: CodePanePlacement,
      kind: 'shell' | 'coding_agent' | 'markdown' | 'preview',
      adapterId?: string | null,
      model?: string | null,
      url?: string
    ) => {
      const { workspaceId, revision } = stateRef.current
      if (!workspaceId) return
      try {
        dispatch({ type: 'SET_MUTATING', isMutating: true })
        const res = await hiveoryClient.applyCodePaneMutation({
          workspace_id: workspaceId,
          expected_revision: revision,
          mutation: { type: 'split', pane_id: paneId, placement },
        })
        dispatch({ type: 'SET_LAYOUT', layout: res.layout })

        const newPaneId = res.layout.focused_pane_id
        if (!newPaneId) return

        let curRev = res.layout.revision ?? 0

        if (kind === 'shell' || kind === 'coding_agent') {
          try {
            const termRes = await hiveoryClient.launchCodePaneTerminal({
              workspace_id: workspaceId,
              pane_id: newPaneId,
              expected_revision: curRev,
              kind,
              adapter_id: adapterId ?? null,
              model: model ?? null,
              cols: 80,
              rows: 24,
            })
            dispatch({ type: 'SET_TERMINAL', terminal: termRes.terminal })
            dispatch({ type: 'SET_LAYOUT', layout: termRes.layout })
          } catch (termErr: unknown) {
            const innerMsg = formatError(termErr)
            if (innerMsg.toLowerCase().includes('trust')) {
              await hiveoryClient.trustCodeWorkspace(workspaceId, true)
              const detail = await hiveoryClient.codeWorkspace(workspaceId)
              curRev = detail.layout.revision ?? 0
              const termRes = await hiveoryClient.launchCodePaneTerminal({
                workspace_id: workspaceId,
                pane_id: newPaneId,
                expected_revision: curRev,
                kind,
                adapter_id: adapterId ?? null,
                model: model ?? null,
                cols: 80,
                rows: 24,
              })
              dispatch({ type: 'SET_TERMINAL', terminal: termRes.terminal })
              dispatch({ type: 'SET_LAYOUT', layout: termRes.layout })
            } else {
              throw termErr
            }
          }
        } else if (kind === 'preview') {
          const prevRes = await hiveoryClient.openCodePanePreview({
            workspace_id: workspaceId,
            pane_id: newPaneId,
            expected_revision: curRev,
            url: url || 'http://localhost:3000',
          })
          dispatch({ type: 'SET_PREVIEW', preview: prevRes.preview })
          dispatch({ type: 'SET_LAYOUT', layout: prevRes.layout })
        } else if (kind === 'markdown') {
          try {
            const markdownRes = await hiveoryClient.createCodePaneMarkdown({
              workspace_id: workspaceId,
              pane_id: newPaneId,
              expected_revision: curRev,
            })
            dispatch({ type: 'SET_LAYOUT', layout: markdownRes.layout })
          } catch (markdownErr: unknown) {
            const innerMsg = formatError(markdownErr)
            if (innerMsg.toLowerCase().includes('trust')) {
              await hiveoryClient.trustCodeWorkspace(workspaceId, true)
              const detail = await hiveoryClient.codeWorkspace(workspaceId)
              curRev = detail.layout.revision ?? 0
              const markdownRes = await hiveoryClient.createCodePaneMarkdown({
                workspace_id: workspaceId,
                pane_id: newPaneId,
                expected_revision: curRev,
              })
              dispatch({ type: 'SET_LAYOUT', layout: markdownRes.layout })
            } else {
              throw markdownErr
            }
          }
        }
      } catch (err: unknown) {
        dispatch({ type: 'SET_ERROR', error: formatError(err) })
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
    },
    []
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
      const { layout } = stateRef.current
      if (!layout || layout.focused_pane_id === paneId) return
      const optimisticLayout = { ...layout, focused_pane_id: paneId }
      stateRef.current = { ...stateRef.current, layout: optimisticLayout, focusedPaneId: paneId }
      dispatch({ type: 'SET_LAYOUT', layout: optimisticLayout })
      void applyMutation({ type: 'focus', pane_id: paneId })
    },
    [applyMutation]
  )

  const toggleMaximize = useCallback(
    async (paneId?: string | null) => {
      const { layout, focusedPaneId, maximizedPaneId } = stateRef.current
      if (!layout) return
      const target = paneId ?? focusedPaneId
      if (!target) return
      const isCurrentlyMaximized = maximizedPaneId === target
      await applyMutation({ type: 'maximize', pane_id: isCurrentlyMaximized ? null : target })
    },
    [applyMutation]
  )

  const applyPreset = useCallback(
    async (preset: CodePanePreset, primaryPaneId?: string | null) => {
      await applyMutation({ type: 'apply_preset', preset, primary_pane_id: primaryPaneId ?? null })
    },
    [applyMutation]
  )

  const launchTerminal = useCallback(
    async (paneId: string, kind: CodeTerminalKind, adapterId?: string | null, model?: string | null) => {
      const { workspaceId, revision } = stateRef.current
      if (!workspaceId) return
      try {
        dispatch({ type: 'SET_MUTATING', isMutating: true })
        let curRev = revision
        try {
          const res = await hiveoryClient.launchCodePaneTerminal({
            workspace_id: workspaceId,
            pane_id: paneId,
            expected_revision: curRev,
            kind,
            adapter_id: adapterId ?? null,
            model: model ?? null,
            cols: 80,
            rows: 24,
          })
          dispatch({ type: 'SET_TERMINAL', terminal: res.terminal })
          dispatch({ type: 'SET_LAYOUT', layout: res.layout })
          return
        } catch (innerErr: unknown) {
          const innerMsg = formatError(innerErr)
          if (innerMsg.toLowerCase().includes('trust')) {
            await hiveoryClient.trustCodeWorkspace(workspaceId, true)
            const detail = await hiveoryClient.codeWorkspace(workspaceId)
            curRev = detail.layout.revision ?? 0
            const res = await hiveoryClient.launchCodePaneTerminal({
              workspace_id: workspaceId,
              pane_id: paneId,
              expected_revision: curRev,
              kind,
              adapter_id: adapterId ?? null,
              model: model ?? null,
              cols: 80,
              rows: 24,
            })
            dispatch({ type: 'SET_TERMINAL', terminal: res.terminal })
            dispatch({ type: 'SET_LAYOUT', layout: res.layout })
            return
          }
          throw innerErr
        }
      } catch (err: unknown) {
        dispatch({ type: 'SET_ERROR', error: formatError(err) })
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
        let curRev = revision
        try {
          const res = await hiveoryClient.openCodePanePreview({
            workspace_id: workspaceId,
            pane_id: paneId,
            expected_revision: curRev,
            url,
          })
          dispatch({ type: 'SET_PREVIEW', preview: res.preview })
          dispatch({ type: 'SET_LAYOUT', layout: res.layout })
          return
        } catch (innerErr: unknown) {
          const innerMsg = formatError(innerErr)
          if (innerMsg.toLowerCase().includes('trust')) {
            await hiveoryClient.trustCodeWorkspace(workspaceId, true)
            const detail = await hiveoryClient.codeWorkspace(workspaceId)
            curRev = detail.layout.revision ?? 0
            const res = await hiveoryClient.openCodePanePreview({
              workspace_id: workspaceId,
              pane_id: paneId,
              expected_revision: curRev,
              url,
            })
            dispatch({ type: 'SET_PREVIEW', preview: res.preview })
            dispatch({ type: 'SET_LAYOUT', layout: res.layout })
            return
          }
          throw innerErr
        }
      } catch (err: unknown) {
        dispatch({ type: 'SET_ERROR', error: formatError(err) })
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
    },
    []
  )

  const createMarkdown = useCallback(
    async (paneId: string) => {
      const { workspaceId, revision } = stateRef.current
      if (!workspaceId) return
      try {
        dispatch({ type: 'SET_MUTATING', isMutating: true })
        let curRev = revision
        try {
          const res = await hiveoryClient.createCodePaneMarkdown({
            workspace_id: workspaceId,
            pane_id: paneId,
            expected_revision: curRev,
          })
          dispatch({ type: 'SET_LAYOUT', layout: res.layout })
          return
        } catch (innerErr: unknown) {
          const innerMsg = formatError(innerErr)
          if (innerMsg.toLowerCase().includes('trust')) {
            await hiveoryClient.trustCodeWorkspace(workspaceId, true)
            const detail = await hiveoryClient.codeWorkspace(workspaceId)
            curRev = detail.layout.revision ?? 0
            const res = await hiveoryClient.createCodePaneMarkdown({
              workspace_id: workspaceId,
              pane_id: paneId,
              expected_revision: curRev,
            })
            dispatch({ type: 'SET_LAYOUT', layout: res.layout })
            return
          }
          throw innerErr
        }
      } catch (err: unknown) {
        dispatch({ type: 'SET_ERROR', error: formatError(err) })
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
    },
    []
  )

  const sleepWorkspace = useCallback(
    async (requestedWorkspaceId?: string) => {
      const workspaceId = requestedWorkspaceId ?? stateRef.current.workspaceId
      if (!workspaceId) return false
      try {
        dispatch({ type: 'SET_MUTATING', isMutating: true })
        const detail = await hiveoryClient.codeWorkspace(workspaceId)
        const activeTerminals = detail.terminals.filter((terminal) => terminal.state === 'running' || terminal.state === 'starting')
        await Promise.all(activeTerminals.map((terminal) => hiveoryClient.stopCodeTerminal({ terminal_id: terminal.id, force: true })))
        if (stateRef.current.workspaceId === workspaceId) {
          await loadWorkspace(workspaceId)
        }
        return true
      } catch (err: unknown) {
        dispatch({ type: 'SET_ERROR', error: formatError(err) })
        return false
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
    },
    [loadWorkspace]
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

      try {
        dispatch({ type: 'SET_MUTATING', isMutating: true })
        const res = await hiveoryClient.closeCodePane({
          workspace_id: workspaceId,
          pane_id: paneId,
          expected_revision: revision,
          terminate_running_resource: false,
        })
        dispatch({ type: 'SET_LAYOUT', layout: res.layout })
      } catch (err: unknown) {
        dispatch({ type: 'SET_ERROR', error: formatError(err) })
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
        const res = await hiveoryClient.closeCodePane({
          workspace_id: workspaceId,
          pane_id: confirmClosePane.paneId,
          expected_revision: revision,
          terminate_running_resource: terminateRunning,
        })
        dispatch({ type: 'SET_LAYOUT', layout: res.layout })
      } catch (err: unknown) {
        dispatch({ type: 'SET_ERROR', error: formatError(err) })
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
    splitAndLaunch,
    renamePane,
    movePane,
    resizeSplit,
    focusPane,
    toggleMaximize,
    applyPreset,
    launchTerminal,
    openPreview,
    createMarkdown,
    sleepWorkspace,
    requestClosePane,
    confirmClose,
    dismissConfirmClose,
    dismissError,
    setError,
  }
}
