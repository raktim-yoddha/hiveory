import { useCallback, useEffect, useReducer, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import {
  DEFAULT_BROWSER_HOME,
  hiveoryClient,
  type CodeDocument,
  type CodePaneMutation,
  type CodePanePlacement,
  type CodePanePreset,
  type CodeLaunchPresetSummary,
  type CodeAgentLaunchMode,
  type CodeTerminalKind,
  type CodeTerminalSummary,
  type CodePreviewSummary,
  type CodeAgentPaneStatus,
  type BrowserRuntimeState,
  type CodeWorkspaceDetail,
} from '../../../../../shared/api/hiveory-client'
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
    url?: string,
    agentLaunchMode?: CodeAgentLaunchMode,
  ) => Promise<void>
  renamePane: (paneId: string, title: string) => Promise<boolean>
  movePane: (paneId: string, targetPaneId: string, placement: CodePanePlacement) => Promise<void>
  resizeSplit: (splitId: string, ratioPercent: number) => Promise<void>
  focusPane: (paneId: string) => Promise<void>
  toggleMaximize: (paneId?: string | null) => Promise<void>
  applyPreset: (preset: CodePanePreset, primaryPaneId?: string | null) => Promise<void>
  openLaunchPreset: (preset: CodeLaunchPresetSummary) => Promise<void>
  launchTerminal: (paneId: string, kind: CodeTerminalKind, adapterId?: string | null, model?: string | null, agentLaunchMode?: CodeAgentLaunchMode) => Promise<void>
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
  const focusPersistTimerRef = useRef<number | null>(null)
  const pendingFocusedPaneRef = useRef<{ workspaceId: string; paneId: string } | null>(null)
  stateRef.current = state

  useEffect(() => () => {
    if (focusPersistTimerRef.current !== null) window.clearTimeout(focusPersistTimerRef.current)
  }, [])

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

  const commitAgentPaneStatuses = useCallback((statuses: CodeAgentPaneStatus[]) => {
    const agentPaneStatuses = new Map(
      statuses
        .filter((status) => status.pane_id)
        .map((status) => [status.pane_id!, status]),
    )
    stateRef.current = { ...stateRef.current, agentPaneStatuses }
    dispatch({ type: 'SET_AGENT_PANE_STATUSES', statuses })
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
    if (focusPersistTimerRef.current !== null) {
      window.clearTimeout(focusPersistTimerRef.current)
      focusPersistTimerRef.current = null
      pendingFocusedPaneRef.current = null
    }
    const run = mutationQueueRef.current.then(operation)
    mutationQueueRef.current = run.then(() => undefined, () => undefined)
    return run
  }, [])

  const commitWorkspaceSnapshot = useCallback((snapshot: CodeWorkspaceDetail, paneStatuses: CodeAgentPaneStatus[] = []) => {
    const current = stateRef.current
    if (
      snapshot.summary.id !== current.workspaceId
      && snapshot.summary.id !== current.loadingWorkspaceId
    ) {
      return false
    }
    stateRef.current = {
      ...current,
      workspaceId: snapshot.summary.id,
      loadingWorkspaceId: null,
      layout: snapshot.layout,
      revision: snapshot.layout.revision ?? 0,
      focusedPaneId: snapshot.layout.focused_pane_id ?? null,
      maximizedPaneId: snapshot.layout.maximized_pane_id ?? null,
      terminals: new Map(snapshot.terminals.map((terminal) => [terminal.id, terminal])),
      previews: new Map(snapshot.previews.map((preview) => [preview.id, preview])),
      agentPaneStatuses: new Map(
        paneStatuses
          .filter((status) => status.pane_id)
          .map((status) => [status.pane_id!, status]),
      ),
    }
    dispatch({
      type: 'SET_WORKSPACE',
      workspaceId: snapshot.summary.id,
      layout: snapshot.layout,
      terminals: snapshot.terminals,
      previews: snapshot.previews,
    })
    dispatch({ type: 'SET_AGENT_PANE_STATUSES', statuses: paneStatuses })
    return true
  }, [])

  const loadWorkspace = useCallback(async (workspaceId: string) => {
    const requestId = ++loadRequestRef.current
    const isWorkspaceSwitch = stateRef.current.workspaceId !== workspaceId
    if (isWorkspaceSwitch) {
      stateRef.current = { ...stateRef.current, loadingWorkspaceId: workspaceId }
      dispatch({ type: 'SET_WORKSPACE_LOADING', workspaceId })
    }
    try {
      const [snapshot, paneStatuses] = await Promise.all([
        hiveoryClient.codeWorkspace(workspaceId),
        hiveoryClient.codeAgentPaneStatuses(workspaceId),
      ])
      if (requestId !== loadRequestRef.current) return
      commitWorkspaceSnapshot(snapshot, paneStatuses)
    } catch (err: unknown) {
      if (requestId !== loadRequestRef.current) return
      dispatch({ type: 'SET_ERROR', error: `Failed to load workspace: ${formatError(err)}` })
    }
  }, [commitWorkspaceSnapshot])

  // A stale layout revision is expected when focus or a resize was persisted just
  // before another action. Refresh it without clearing the canvas, so browser and
  // terminal surfaces remain mounted while the original action retries.
  const refreshWorkspace = useCallback(async (workspaceId: string) => {
    const requestId = ++loadRequestRef.current
    const [snapshot, paneStatuses] = await Promise.all([
      hiveoryClient.codeWorkspace(workspaceId),
      hiveoryClient.codeAgentPaneStatuses(workspaceId),
    ])
    if (requestId !== loadRequestRef.current || stateRef.current.workspaceId !== workspaceId) return false
    return commitWorkspaceSnapshot(snapshot, paneStatuses)
  }, [commitWorkspaceSnapshot])

  useEffect(() => {
    if (initialWorkspaceId && initialWorkspaceId !== state.workspaceId) {
      void loadWorkspace(initialWorkspaceId)
    }
  }, [initialWorkspaceId, loadWorkspace, state.workspaceId])

  useEffect(() => {
    const workspaceId = state.workspaceId
    if (!workspaceId) return undefined
    const refresh = () => {
      void hiveoryClient.codeAgentPaneStatuses(workspaceId)
        .then((statuses) => {
          if (stateRef.current.workspaceId === workspaceId) commitAgentPaneStatuses(statuses)
        })
        .catch(() => undefined)
    }
    refresh()
    const interval = window.setInterval(refresh, 500)
    return () => window.clearInterval(interval)
  }, [commitAgentPaneStatuses, state.workspaceId])

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

  // CLI browser tools can create a Preview pane from outside the renderer
  // mutation queue.  Subscribe to that host event so the new pane is mounted
  // immediately instead of waiting for the next workspace reload.
  useEffect(() => {
    if (!hiveoryClient.isTauri) return
    let disposed = false
    let unlistenPreviewOpened: (() => void) | null = null
    let unlistenAgentPaneOpened: (() => void) | null = null
    let unlistenLayoutUpdated: (() => void) | null = null
    void listen<{ layout: CodeWorkspaceState['layout']; preview: CodePreviewSummary }>('hiveory-code-preview-opened', (event) => {
      if (disposed || !event.payload.layout || !event.payload.preview) return
      if (event.payload.layout.workspace_id !== stateRef.current.workspaceId) return
      commitPreview(event.payload.preview)
      commitLayout(event.payload.layout)
    }).then((remove) => {
      if (disposed) remove()
      else unlistenPreviewOpened = remove
    }).catch(() => undefined)
    void listen<{ layout: CodeWorkspaceState['layout']; terminal: CodeTerminalSummary }>('hiveory-code-agent-pane-opened', (event) => {
      if (disposed || !event.payload.layout || !event.payload.terminal) return
      if (event.payload.layout.workspace_id !== stateRef.current.workspaceId) return
      commitTerminal(event.payload.terminal)
      commitLayout(event.payload.layout)
    }).then((remove) => {
      if (disposed) remove()
      else unlistenAgentPaneOpened = remove
    }).catch(() => undefined)
    void listen<CodeWorkspaceState['layout']>('hiveory-code-layout-updated', (event) => {
      if (disposed || !event.payload || event.payload.workspace_id !== stateRef.current.workspaceId) return
      commitLayout(event.payload)
    }).then((remove) => {
      if (disposed) remove()
      else unlistenLayoutUpdated = remove
    }).catch(() => undefined)
    return () => {
      disposed = true
      unlistenPreviewOpened?.()
      unlistenAgentPaneOpened?.()
      unlistenLayoutUpdated?.()
    }
  }, [commitLayout, commitPreview, commitTerminal])

  const clearWorkspace = useCallback(() => {
    loadRequestRef.current += 1
    stateRef.current = {
      ...initialCodeWorkspaceState,
      terminals: new Map(),
      previews: new Map(),
    }
    dispatch({ type: 'CLEAR_WORKSPACE' })
  }, [])

  const applyMutation = useCallback((mutation: CodePaneMutation, trackMutation = true): Promise<boolean> => {
    if (mutation.type !== 'focus' && focusPersistTimerRef.current !== null) {
      window.clearTimeout(focusPersistTimerRef.current)
      focusPersistTimerRef.current = null
      pendingFocusedPaneRef.current = null
    }
    const run = mutationQueueRef.current.then(async () => {
      const { workspaceId, revision } = stateRef.current
      if (!workspaceId) return false
      try {
        if (trackMutation) dispatch({ type: 'SET_MUTATING', isMutating: true })
        const save = (expectedRevision: number) => hiveoryClient.applyCodePaneMutation({
          workspace_id: workspaceId,
          expected_revision: expectedRevision,
          mutation,
        })
        let expectedRevision = revision
        for (let attempt = 0; ; attempt += 1) {
          try {
            const res = await save(expectedRevision)
            commitLayout(res.layout)
            return true
          } catch (err: unknown) {
            if (!formatError(err).includes('layout_conflict') || attempt === 3) throw err
            await refreshWorkspace(workspaceId)
            expectedRevision = stateRef.current.revision
          }
        }
      } catch (err: unknown) {
        const msg = formatError(err)
        if (msg.includes('layout_conflict')) {
          dispatch({ type: 'SET_ERROR', error: 'The layout changed while saving. Please try again.' })
        } else {
          dispatch({ type: 'SET_ERROR', error: msg })
        }
        return false
      } finally {
        if (trackMutation) dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
    })
    mutationQueueRef.current = run.then(() => undefined, () => undefined)
    return run
  }, [commitLayout, refreshWorkspace])

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
      url?: string,
      agentLaunchMode: CodeAgentLaunchMode = 'standard',
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
          await refreshWorkspace(workspaceId)
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
                  reasoning_effort: null,
                  agent_launch_mode: agentLaunchMode,
                  cols: 80,
                  rows: 24,
                })
              } catch (termErr: unknown) {
                const innerMsg = formatError(termErr)
                if (innerMsg.toLowerCase().includes('trust') && !trustRetried) {
                  await hiveoryClient.trustCodeWorkspace(workspaceId, true)
                  await refreshWorkspace(workspaceId)
                  expectedRevision = stateRef.current.revision
                  trustRetried = true
                  continue
                }
                if (innerMsg.includes('layout_conflict') && !conflictRetried) {
                  await refreshWorkspace(workspaceId)
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
              url: url || DEFAULT_BROWSER_HOME,
            })
          } catch (previewErr: unknown) {
            if (!formatError(previewErr).includes('layout_conflict')) throw previewErr
            await refreshWorkspace(workspaceId)
            prevRes = await hiveoryClient.openCodePanePreview({
              workspace_id: workspaceId,
              pane_id: newPaneId,
              expected_revision: stateRef.current.revision,
              url: url || DEFAULT_BROWSER_HOME,
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
                await refreshWorkspace(workspaceId)
                expectedRevision = stateRef.current.revision
                trustRetried = true
                continue
              }
              if (innerMsg.includes('layout_conflict') && !conflictRetried) {
                await refreshWorkspace(workspaceId)
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
    [commitLayout, commitPreview, commitTerminal, enqueueOperation, refreshWorkspace]
  )

  const renamePane = useCallback(
    async (paneId: string, title: string) => {
      const trimmed = title.trim()
      if (!trimmed) return false
      return applyMutation({ type: 'rename', pane_id: paneId, title: trimmed })
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
      if (focusPersistTimerRef.current !== null) window.clearTimeout(focusPersistTimerRef.current)
      const workspaceId = stateRef.current.workspaceId
      if (!workspaceId) return
      pendingFocusedPaneRef.current = { workspaceId, paneId }
      focusPersistTimerRef.current = window.setTimeout(() => {
        focusPersistTimerRef.current = null
        const pendingFocus = pendingFocusedPaneRef.current
        pendingFocusedPaneRef.current = null
        const currentLayout = stateRef.current.layout
        if (
          !pendingFocus ||
          pendingFocus.workspaceId !== stateRef.current.workspaceId ||
          !currentLayout?.nodes.some((node) => node.pane_id === pendingFocus.paneId)
        ) return
        // Focus has already updated locally. Persist it in the background
        // without toggling the canvas-wide mutation lock or blocking resize.
        void applyMutation({ type: 'focus', pane_id: pendingFocus.paneId }, false)
      }, 120)
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
    async (paneId: string, kind: CodeTerminalKind, adapterId?: string | null, model?: string | null, agentLaunchMode: CodeAgentLaunchMode = 'standard') => {
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
            reasoning_effort: null,
            agent_launch_mode: agentLaunchMode,
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
              reasoning_effort: null,
              agent_launch_mode: agentLaunchMode,
              cols: 80,
              rows: 24,
            })
            commitTerminal(res.terminal)
            commitLayout(res.layout)
            return
          }
          if (innerMsg.includes('layout_conflict')) {
            await refreshWorkspace(workspaceId)
            const res = await hiveoryClient.launchCodePaneTerminal({
              workspace_id: workspaceId,
              pane_id: paneId,
              expected_revision: stateRef.current.revision,
              kind,
              adapter_id: adapterId ?? null,
              model: model ?? null,
              reasoning_effort: null,
              agent_launch_mode: agentLaunchMode,
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
    [commitLayout, commitTerminal, enqueueOperation, refreshWorkspace]
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
            await refreshWorkspace(workspaceId)
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
    [commitLayout, commitPreview, enqueueOperation, refreshWorkspace]
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
            await refreshWorkspace(workspaceId)
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
    [commitLayout, enqueueOperation, refreshWorkspace]
  )

  const openLaunchPreset = useCallback(async (preset: CodeLaunchPresetSummary) => {
    let targets: Awaited<ReturnType<typeof hiveoryClient.openCodeLaunchPreset>>['targets'] = []
    let launchError: unknown = null
    await enqueueOperation(async () => {
      const { workspaceId, revision } = stateRef.current
      if (!workspaceId) return
      try {
        dispatch({ type: 'SET_MUTATING', isMutating: true })
        const result = await hiveoryClient.openCodeLaunchPreset({
          preset_id: preset.id,
          workspace_id: workspaceId,
          expected_revision: revision,
        })
        targets = result.targets
        commitLayout(result.layout)
      } catch (err: unknown) {
        launchError = err
        dispatch({ type: 'SET_ERROR', error: formatError(err) })
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
    })
    if (launchError) throw launchError
    for (const target of targets) {
      if (target.entry.kind === 'coding_agent') {
        await launchTerminal(target.pane_id, 'coding_agent', target.entry.adapter_id, null, target.entry.agent_launch_mode)
      } else if (target.entry.kind === 'terminal') {
        await launchTerminal(target.pane_id, 'shell', target.entry.adapter_id)
      } else if (target.entry.kind === 'browser') {
        await openPreview(target.pane_id, target.entry.url ?? DEFAULT_BROWSER_HOME)
      } else {
        await createMarkdown(target.pane_id)
      }
    }
  }, [commitLayout, createMarkdown, enqueueOperation, launchTerminal, openPreview])

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
            await refreshWorkspace(workspaceId)
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
    [commitLayout, enqueueOperation, refreshWorkspace]
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
            await refreshWorkspace(workspaceId)
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
    [commitLayout, enqueueOperation, refreshWorkspace]
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
          await refreshWorkspace(workspaceId)
        }
        return true
      } catch (err: unknown) {
        dispatch({ type: 'SET_ERROR', error: formatError(err) })
        return false
      } finally {
        dispatch({ type: 'SET_MUTATING', isMutating: false })
      }
    },
    [refreshWorkspace]
  )

  const closePaneWithRetry = useCallback(
    async (paneId: string, terminateRunningResource: boolean) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const { workspaceId, revision, layout } = stateRef.current
        if (!workspaceId || !layout?.nodes.some((node) => node.pane_id === paneId)) return
        try {
          const result = await hiveoryClient.closeCodePane({
            workspace_id: workspaceId,
            pane_id: paneId,
            expected_revision: revision,
            terminate_running_resource: terminateRunningResource,
          })
          commitLayout(result.layout)
          return
        } catch (error: unknown) {
          if (!formatError(error).includes('layout_conflict') || attempt === 3) throw error
          await refreshWorkspace(workspaceId)
        }
      }
    },
    [commitLayout, refreshWorkspace],
  )

  const requestClosePane = useCallback(
    async (paneId: string) => {
      const { layout, terminals, workspaceId } = stateRef.current
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
          await closePaneWithRetry(paneId, false)
        } catch (err: unknown) {
          dispatch({ type: 'SET_ERROR', error: formatError(err) })
        } finally {
          dispatch({ type: 'SET_MUTATING', isMutating: false })
        }
      })
    },
    [closePaneWithRetry, enqueueOperation]
  )

  const confirmClose = useCallback(
    async (terminateRunning: boolean) => {
      const { confirmClosePane } = stateRef.current
      if (!confirmClosePane) return
      const paneId = confirmClosePane.paneId
      dispatch({ type: 'SET_CONFIRM_CLOSE', confirm: null })
      await enqueueOperation(async () => {
        try {
          dispatch({ type: 'SET_MUTATING', isMutating: true })
          await closePaneWithRetry(paneId, terminateRunning)
        } catch (err: unknown) {
          dispatch({ type: 'SET_ERROR', error: formatError(err) })
        } finally {
          dispatch({ type: 'SET_MUTATING', isMutating: false })
        }
      })
    },
    [closePaneWithRetry, enqueueOperation]
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
    openLaunchPreset,
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
