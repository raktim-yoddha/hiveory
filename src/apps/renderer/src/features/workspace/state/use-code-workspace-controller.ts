import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  hiveoryClient,
  type CodeDocument,
  type CodePaneMutation,
  type CodePanePlacement,
  type CodePanePreset,
  type CodeTerminalKind,
  type CodeTerminalSummary,
  type CodePreviewSummary,
  type BrowserRuntimeState,
} from '../../../shared/api/hiveory-client'
import {
  codeWorkspaceReducer,
  initialCodeWorkspaceState,
  type CodeWorkspaceState,
} from './code-workspace-reducer'

export interface CodeWorkspaceController {
  state: CodeWorkspaceState
  clearWorkspace: () => void
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
  updatePreviewState: (state: BrowserRuntimeState) => void
  createMarkdown: (paneId: string) => Promise<void>
  openMarkdown: (paneId: string, relativePath: string) => Promise<void>
  renameMarkdown: (paneId: string, relativePath: string, newRelativePath: string, expectedFingerprint: string | null) => Promise<CodeDocument | null>
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
  const terminalLaunchesRef = useRef(new Set<string>())
  stateRef.current = state

  const commitLayout = useCallback((layout: CodeWorkspaceState['layout']) => {
    if (!layout) return
    const current = stateRef.current
    stateRef.current = {
      ...current,
      layout,
      revision: layout.revision ?? current.revision + 1,
      focusedPaneId: layout.focused_pane_id ?? current.focusedPaneId,
      maximizedPaneId: layout.maximized_pane_id ?? null,
    }
    dispatch({ type: 'SET_LAYOUT', layout })
  }, [])

  const commitTerminal = useCallback((terminal: CodeTerminalSummary) => {
    const terminals = new Map(stateRef.current.terminals)
    terminals.set(terminal.id, terminal)
    stateRef.current = { ...stateRef.current, terminals }
    dispatch({ type: 'SET_TERMINAL', terminal })
  }, [])

  const commitPreview = useCallback((preview: CodePreviewSummary) => {
    const previews = new Map(stateRef.current.previews)
    previews.set(preview.id, preview)
    stateRef.current = { ...stateRef.current, previews }
    dispatch({ type: 'SET_PREVIEW', preview })
  }, [])

  const updatePreviewState = useCallback((browserState: BrowserRuntimeState) => {
    const currentPreview = stateRef.current.previews.get(browserState.browser_id)
    if (!currentPreview) return
    let origin = currentPreview.origin
    try {
      origin = new URL(browserState.url).origin
    } catch {
      // Keep the last known origin if a transient native navigation state is malformed.
    }
    commitPreview({ ...currentPreview, url: browserState.url, origin })
  }, [commitPreview])

  const enqueueOperation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const run = mutationQueueRef.current.then(operation)
    mutationQueueRef.current = run.then(() => undefined, () => undefined)
    return run
  }, [])

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
        terminals: new Map(snapshot.terminals.map((terminal) => [terminal.id, terminal])),
        previews: new Map(snapshot.previews.map((preview) => [preview.id, preview])),
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

  const clearWorkspace = useCallback(() => {
    loadRequestRef.current += 1
    stateRef.current = {
      ...initialCodeWorkspaceState,
      terminals: new Map(),
      previews: new Map(),
    }
    dispatch({ type: 'CLEAR_WORKSPACE' })
  }, [])

  const applyMutation = useCallback((mutation: CodePaneMutation) => {
    const run = mutationQueueRef.current.then(async () => {
      const { workspaceId, revision } = stateRef.current
      if (!workspaceId) return
      try {
        dispatch({ type: 'SET_MUTATING', isMutating: true })
        const save = (expectedRevision: number) => hiveoryClient.applyCodePaneMutation({
          workspace_id: workspaceId,
          expected_revision: expectedRevision,
          mutation,
        })
        let res
        try {
          res = await save(revision)
        } catch (err: unknown) {
          if (!formatError(err).includes('layout_conflict')) throw err
          await loadWorkspace(workspaceId)
          res = await save(stateRef.current.revision)
        }
        commitLayout(res.layout)
      } catch (err: unknown) {
        const msg = formatError(err)
        if (msg.includes('layout_conflict')) {
          dispatch({ type: 'SET_ERROR', error: 'The layout changed while saving. Please try again.' })
        } else {
          dispatch({ type: 'SET_ERROR', error: msg })
        }
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
    })
    mutationQueueRef.current = run.catch(() => undefined)
    return run
  }, [commitLayout, loadWorkspace])

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
      await enqueueOperation(async () => {
      const { workspaceId, revision } = stateRef.current
      if (!workspaceId) return
      try {
        dispatch({ type: 'SET_MUTATING', isMutating: true })
        const split = (expectedRevision: number) => hiveoryClient.applyCodePaneMutation({
          workspace_id: workspaceId,
          expected_revision: expectedRevision,
          mutation: { type: 'split', pane_id: paneId, placement },
        })
        let res
        try {
          res = await split(revision)
        } catch (err: unknown) {
          if (!formatError(err).includes('layout_conflict')) throw err
          await loadWorkspace(workspaceId)
          res = await split(stateRef.current.revision)
        }
        commitLayout(res.layout)

        const newPaneId = res.layout.focused_pane_id
        if (!newPaneId) return

        const curRev = res.layout.revision ?? 0

        if (kind === 'shell' || kind === 'coding_agent') {
          const launchDockedTerminal = async () => {
            let expectedRevision = curRev
            let conflictRetried = false
            let trustRetried = false
            while (true) {
              try {
                return await hiveoryClient.launchCodePaneTerminal({
                  workspace_id: workspaceId,
                  pane_id: newPaneId,
                  expected_revision: expectedRevision,
                  kind,
                  adapter_id: adapterId ?? null,
                  model: model ?? null,
                  cols: 80,
                  rows: 24,
                })
              } catch (termErr: unknown) {
                const innerMsg = formatError(termErr)
                if (innerMsg.toLowerCase().includes('trust') && !trustRetried) {
                  await hiveoryClient.trustCodeWorkspace(workspaceId, true)
                  await loadWorkspace(workspaceId)
                  expectedRevision = stateRef.current.revision
                  trustRetried = true
                  continue
                }
                if (innerMsg.includes('layout_conflict') && !conflictRetried) {
                  await loadWorkspace(workspaceId)
                  expectedRevision = stateRef.current.revision
                  conflictRetried = true
                  continue
                }
                throw termErr
              }
            }
          }
          const termRes = await launchDockedTerminal()
          commitTerminal(termRes.terminal)
          commitLayout(termRes.layout)
        } else if (kind === 'preview') {
          let prevRes
          try {
            prevRes = await hiveoryClient.openCodePanePreview({
              workspace_id: workspaceId,
              pane_id: newPaneId,
              expected_revision: curRev,
              url: url || 'http://localhost:3000',
            })
          } catch (previewErr: unknown) {
            if (!formatError(previewErr).includes('layout_conflict')) throw previewErr
            await loadWorkspace(workspaceId)
            prevRes = await hiveoryClient.openCodePanePreview({
              workspace_id: workspaceId,
              pane_id: newPaneId,
              expected_revision: stateRef.current.revision,
              url: url || 'http://localhost:3000',
            })
          }
          commitPreview(prevRes.preview)
          commitLayout(prevRes.layout)
        } else if (kind === 'markdown') {
          let markdownRes
          let expectedRevision = curRev
          let conflictRetried = false
          let trustRetried = false
          while (!markdownRes) {
            try {
              markdownRes = await hiveoryClient.createCodePaneMarkdown({
                workspace_id: workspaceId,
                pane_id: newPaneId,
                expected_revision: expectedRevision,
              })
            } catch (markdownErr: unknown) {
              const innerMsg = formatError(markdownErr)
              if (innerMsg.toLowerCase().includes('trust') && !trustRetried) {
                await hiveoryClient.trustCodeWorkspace(workspaceId, true)
                await loadWorkspace(workspaceId)
                expectedRevision = stateRef.current.revision
                trustRetried = true
                continue
              }
              if (innerMsg.includes('layout_conflict') && !conflictRetried) {
                await loadWorkspace(workspaceId)
                expectedRevision = stateRef.current.revision
                conflictRetried = true
                continue
              }
              throw markdownErr
            }
          }
          commitLayout(markdownRes.layout)
        }
      } catch (err: unknown) {
        dispatch({ type: 'SET_ERROR', error: formatError(err) })
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
      })
    },
    [commitLayout, commitPreview, commitTerminal, enqueueOperation, loadWorkspace]
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
      await enqueueOperation(async () => {
      const { workspaceId, revision } = stateRef.current
      if (!workspaceId) return
      const pane = stateRef.current.layout?.nodes.find((node) => node.pane_id === paneId)
      const existingTerminal = pane?.resource_id ? stateRef.current.terminals.get(pane.resource_id) : null
      if (existingTerminal?.state === 'running' || existingTerminal?.state === 'starting') return

      const launchKey = `${workspaceId}:${paneId}`
      if (terminalLaunchesRef.current.has(launchKey)) return
      terminalLaunchesRef.current.add(launchKey)
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
          commitTerminal(res.terminal)
          commitLayout(res.layout)
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
            commitTerminal(res.terminal)
            commitLayout(res.layout)
            return
          }
          if (innerMsg.includes('layout_conflict')) {
            await loadWorkspace(workspaceId)
            const res = await hiveoryClient.launchCodePaneTerminal({
              workspace_id: workspaceId,
              pane_id: paneId,
              expected_revision: stateRef.current.revision,
              kind,
              adapter_id: adapterId ?? null,
              model: model ?? null,
              cols: 80,
              rows: 24,
            })
            commitTerminal(res.terminal)
            commitLayout(res.layout)
            return
          }
          throw innerErr
        }
      } catch (err: unknown) {
        dispatch({ type: 'SET_ERROR', error: formatError(err) })
      } finally {
        terminalLaunchesRef.current.delete(launchKey)
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
      })
    },
    [commitLayout, commitTerminal, enqueueOperation, loadWorkspace]
  )

  const openPreview = useCallback(
    async (paneId: string, url: string) => {
      await enqueueOperation(async () => {
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
          commitPreview(res.preview)
          commitLayout(res.layout)
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
            commitPreview(res.preview)
            commitLayout(res.layout)
            return
          }
          if (innerMsg.includes('layout_conflict')) {
            await loadWorkspace(workspaceId)
            const res = await hiveoryClient.openCodePanePreview({
              workspace_id: workspaceId,
              pane_id: paneId,
              expected_revision: stateRef.current.revision,
              url,
            })
            commitPreview(res.preview)
            commitLayout(res.layout)
            return
          }
          throw innerErr
        }
      } catch (err: unknown) {
        dispatch({ type: 'SET_ERROR', error: formatError(err) })
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
      })
    },
    [commitLayout, commitPreview, enqueueOperation, loadWorkspace]
  )

  const createMarkdown = useCallback(
    async (paneId: string) => {
      await enqueueOperation(async () => {
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
          commitLayout(res.layout)
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
            commitLayout(res.layout)
            return
          }
          if (innerMsg.includes('layout_conflict')) {
            await loadWorkspace(workspaceId)
            const res = await hiveoryClient.createCodePaneMarkdown({
              workspace_id: workspaceId,
              pane_id: paneId,
              expected_revision: stateRef.current.revision,
            })
            commitLayout(res.layout)
            return
          }
          throw innerErr
        }
      } catch (err: unknown) {
        dispatch({ type: 'SET_ERROR', error: formatError(err) })
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
      })
    },
    [commitLayout, enqueueOperation, loadWorkspace]
  )

  const openMarkdown = useCallback(
    async (paneId: string, relativePath: string) => {
      await enqueueOperation(async () => {
        const { workspaceId, revision } = stateRef.current
        if (!workspaceId) return
        try {
          dispatch({ type: 'SET_MUTATING', isMutating: true })
          let result
          try {
            result = await hiveoryClient.openCodePaneMarkdown({
              workspace_id: workspaceId,
              pane_id: paneId,
              expected_revision: revision,
              relative_path: relativePath,
            })
          } catch (innerErr: unknown) {
            if (!formatError(innerErr).includes('layout_conflict')) throw innerErr
            await loadWorkspace(workspaceId)
            result = await hiveoryClient.openCodePaneMarkdown({
              workspace_id: workspaceId,
              pane_id: paneId,
              expected_revision: stateRef.current.revision,
              relative_path: relativePath,
            })
          }
          commitLayout(result.layout)
        } catch (err: unknown) {
          dispatch({ type: 'SET_ERROR', error: formatError(err) })
        } finally {
          dispatch({ type: 'SET_MUTATING', isMutating: false })
        }
      })
    },
    [commitLayout, enqueueOperation, loadWorkspace]
  )

  const renameMarkdown = useCallback(
    async (
      paneId: string,
      relativePath: string,
      newRelativePath: string,
      expectedFingerprint: string | null,
    ): Promise<CodeDocument | null> => {
      let renamed: CodeDocument | null = null
      await enqueueOperation(async () => {
        const { workspaceId, revision } = stateRef.current
        if (!workspaceId) return
        try {
          dispatch({ type: 'SET_MUTATING', isMutating: true })
          let result
          try {
            result = await hiveoryClient.renameCodeFile({
              workspace_id: workspaceId,
              pane_id: paneId,
              expected_revision: revision,
              relative_path: relativePath,
              new_relative_path: newRelativePath,
              expected_fingerprint: expectedFingerprint,
            })
          } catch (innerErr: unknown) {
            if (!formatError(innerErr).includes('layout_conflict')) throw innerErr
            await loadWorkspace(workspaceId)
            result = await hiveoryClient.renameCodeFile({
              workspace_id: workspaceId,
              pane_id: paneId,
              expected_revision: stateRef.current.revision,
              relative_path: relativePath,
              new_relative_path: newRelativePath,
              expected_fingerprint: expectedFingerprint,
            })
          }
          renamed = result.document
          commitLayout(result.layout)
        } catch (err: unknown) {
          dispatch({ type: 'SET_ERROR', error: formatError(err) })
        } finally {
          dispatch({ type: 'SET_MUTATING', isMutating: false })
        }
      })
      return renamed
    },
    [commitLayout, enqueueOperation, loadWorkspace]
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

      await enqueueOperation(async () => {
        try {
          dispatch({ type: 'SET_MUTATING', isMutating: true })
          const close = (expectedRevision: number) => hiveoryClient.closeCodePane({
            workspace_id: workspaceId,
            pane_id: paneId,
            expected_revision: expectedRevision,
            terminate_running_resource: false,
          })
          let res
          try {
            res = await close(revision)
          } catch (err: unknown) {
            if (!formatError(err).includes('layout_conflict')) throw err
            await loadWorkspace(workspaceId)
            res = await close(stateRef.current.revision)
          }
          commitLayout(res.layout)
        } catch (err: unknown) {
          dispatch({ type: 'SET_ERROR', error: formatError(err) })
        } finally {
          dispatch({ type: 'SET_MUTATING', isMutating: false })
        }
      })
    },
    [commitLayout, enqueueOperation, loadWorkspace]
  )

  const confirmClose = useCallback(
    async (terminateRunning: boolean) => {
      const { confirmClosePane, workspaceId, revision } = stateRef.current
      if (!confirmClosePane || !workspaceId) return
      const paneId = confirmClosePane.paneId
      dispatch({ type: 'SET_CONFIRM_CLOSE', confirm: null })
      await enqueueOperation(async () => {
        try {
          dispatch({ type: 'SET_MUTATING', isMutating: true })
          const close = (expectedRevision: number) => hiveoryClient.closeCodePane({
            workspace_id: workspaceId,
            pane_id: paneId,
            expected_revision: expectedRevision,
            terminate_running_resource: terminateRunning,
          })
          let res
          try {
            res = await close(revision)
          } catch (err: unknown) {
            if (!formatError(err).includes('layout_conflict')) throw err
            await loadWorkspace(workspaceId)
            res = await close(stateRef.current.revision)
          }
          commitLayout(res.layout)
        } catch (err: unknown) {
          dispatch({ type: 'SET_ERROR', error: formatError(err) })
        } finally {
          dispatch({ type: 'SET_MUTATING', isMutating: false })
        }
      })
    },
    [commitLayout, enqueueOperation, loadWorkspace]
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
    clearWorkspace,
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
    updatePreviewState,
    createMarkdown,
    openMarkdown,
    renameMarkdown,
    sleepWorkspace,
    requestClosePane,
    confirmClose,
    dismissConfirmClose,
    dismissError,
    setError,
  }
}
