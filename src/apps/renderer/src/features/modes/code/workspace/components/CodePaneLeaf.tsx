import React, { Component, lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { hiveoryClient, type BrowserRuntimeState, type CodePaneNode } from '../../../../../shared/api/hiveory-client'
import type { CodeWorkspaceController } from '../state/use-code-workspace-controller'
import { CodePaneHeader } from './CodePaneHeader'
import { CodePaneDropTargets } from './CodePaneDropTargets'
import { CodePaneLauncher } from './CodePaneLauncher'
import type { CodeTerminalVoiceState } from './panes/CodeTerminalPane'

const CodeTerminalPane = lazy(async () => ({ default: (await import('./panes/CodeTerminalPane')).CodeTerminalPane }))
const CodePreviewPane = lazy(async () => ({ default: (await import('./panes/CodePreviewPane')).CodePreviewPane }))
const CodeMarkdownPane = lazy(async () => ({ default: (await import('./panes/CodeMarkdownPane')).CodeMarkdownPane }))
const paneFallback = <div className="code-pane-empty-message" role="status">Loading pane…</div>

interface ErrorBoundaryProps {
  children: ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

class PaneErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="code-pane-error">
          <h4>Pane error</h4>
          <p>{this.state.error?.message || 'An unexpected error occurred in this pane.'}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

interface CodePaneLeafProps {
  node: CodePaneNode
  controller: CodeWorkspaceController
  isDragActive?: boolean
  draggedPaneId?: string | null
}

export const CodePaneLeaf: React.FC<CodePaneLeafProps> = ({
  node,
  controller,
  isDragActive = false,
  draggedPaneId = null,
}) => {
  const {
    state,
    focusPane,
    renamePane,
    splitAndLaunch,
    openLaunchPreset,
    toggleMaximize,
    requestClosePane,
    launchTerminal,
    openPreview,
    updatePreviewState,
    createMarkdown,
    openMarkdown,
    renameMarkdown,
  } = controller
  const isFocused = state.focusedPaneId === node.pane_id
  const isMaximized = state.maximizedPaneId === node.pane_id
  const [historyEnabled, setHistoryEnabled] = useState(true)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [voiceState, setVoiceState] = useState<CodeTerminalVoiceState | null>(null)

  const terminalSummary = node.resource_id ? state.terminals.get(node.resource_id) : undefined
  const previewSummary = node.resource_id ? state.previews.get(node.resource_id) : undefined
  const agentStatus = node.kind === 'coding_agent' ? state.agentPaneStatuses.get(node.pane_id) : undefined
  const handleVoiceStateChange = useCallback((nextState: CodeTerminalVoiceState | null) => {
    setVoiceState(nextState)
  }, [])

  const hasTerminalVoice = (node.kind === 'terminal' || node.kind === 'coding_agent') && Boolean(node.resource_id && terminalSummary)

  useEffect(() => {
    if (!hasTerminalVoice) setVoiceState(null)
  }, [hasTerminalVoice])

  const focusCurrentPane = useCallback(() => {
    if (!isFocused) void focusPane(node.pane_id)
  }, [focusPane, isFocused, node.pane_id])

  useEffect(() => {
    const terminalId = node.kind === 'terminal' || node.kind === 'coding_agent' ? node.resource_id : null
    if (!terminalId) return

    let mounted = true
    setHistoryEnabled(true)
    setHistoryError(null)
    void hiveoryClient.getCodeTerminalHistoryEnabled(terminalId)
      .then((enabled) => {
        if (mounted) setHistoryEnabled(enabled)
      })
      .catch(() => undefined)
    return () => {
      mounted = false
    }
  }, [node.kind, node.resource_id])

  const toggleTerminalHistory = async () => {
    const terminalId = node.resource_id
    if (!terminalId || historyBusy) return

    const nextValue = !historyEnabled
    setHistoryEnabled(nextValue)
    setHistoryBusy(true)
    try {
      await hiveoryClient.setCodeTerminalHistoryEnabled({ terminal_id: terminalId, enabled: nextValue })
    } catch (error: unknown) {
      setHistoryEnabled(!nextValue)
      const message = error instanceof Error ? error.message : String(error)
      setHistoryError(`History setting could not be saved: ${message}`)
    } finally {
      setHistoryBusy(false)
    }
  }

  const renderContent = () => {
    switch (node.kind) {
      case 'empty':
        return (
          <CodePaneLauncher
            workspaceId={state.workspaceId!}
            allowPresets={state.layout!.nodes.length === 1 && state.layout!.nodes[0]?.kind === 'empty' && !state.layout!.nodes[0]?.resource_id}
            onLaunch={(kind, adapterId, url, agentLaunchMode) => {
              if (kind === 'shell' || kind === 'coding_agent') {
                void launchTerminal(node.pane_id, kind, adapterId, null, agentLaunchMode)
              } else if (kind === 'preview') {
                void openPreview(node.pane_id, url ?? 'https://www.google.com')
              } else {
                void createMarkdown(node.pane_id)
              }
            }}
            onOpenPreset={openLaunchPreset}
          />
        )
      case 'terminal':
      case 'coding_agent':
        if (!node.resource_id || !terminalSummary) {
          return (
            <CodePaneLauncher
              workspaceId={state.workspaceId!}
              allowPresets={state.layout!.nodes.length === 1 && state.layout!.nodes[0]?.kind === 'empty' && !state.layout!.nodes[0]?.resource_id}
              onLaunch={(kind, adapterId, url, agentLaunchMode) => {
                if (kind === 'shell' || kind === 'coding_agent') {
                  void launchTerminal(node.pane_id, kind, adapterId, null, agentLaunchMode)
                } else if (kind === 'preview') {
                  void openPreview(node.pane_id, url ?? 'https://www.google.com')
                } else {
                  void createMarkdown(node.pane_id)
                }
              }}
              onOpenPreset={openLaunchPreset}
            />
          )
        }
        return (
          <Suspense fallback={paneFallback}>
            <CodeTerminalPane
              terminalId={node.resource_id}
              summary={terminalSummary}
              historyError={historyError}
              onDismissHistoryError={() => setHistoryError(null)}
              onVoiceStateChange={handleVoiceStateChange}
              onRelaunch={() => {
                void launchTerminal(node.pane_id, node.kind === 'coding_agent' ? 'coding_agent' : 'shell', terminalSummary?.adapter_id, terminalSummary?.model, terminalSummary?.agent_launch_mode)
              }}
            />
          </Suspense>
        )
      case 'preview':
        if (!previewSummary) return <div className="code-preview-native-placeholder">Loading Browser…</div>
        return (
          <Suspense fallback={paneFallback}>
            <CodePreviewPane
              key={previewSummary.id}
              workspaceId={state.workspaceId ?? previewSummary.workspace_id}
              preview={previewSummary}
              onStateChange={(nextState: BrowserRuntimeState) => updatePreviewState(nextState)}
              onFocus={focusCurrentPane}
            />
          </Suspense>
        )
      case 'markdown':
        if (!node.resource_id || !state.workspaceId) return <div className="code-pane-empty-message">No Markdown document bound</div>
        return (
          <Suspense fallback={paneFallback}>
            <CodeMarkdownPane
              key={node.resource_id}
              workspaceId={state.workspaceId}
              relativePath={node.resource_id}
              onOpenMarkdown={(path) => void openMarkdown(node.pane_id, path)}
              onCreateMarkdown={() => void createMarkdown(node.pane_id)}
              onRenameMarkdown={(path, fingerprint) => renameMarkdown(node.pane_id, node.resource_id!, path, fingerprint)}
            />
          </Suspense>
        )
      default:
        return <div>Unsupported pane type</div>
    }
  }

  return (
    <div
      className={`code-pane-leaf ${isFocused ? 'focused' : ''}`}
      data-pane-id={node.pane_id}
      onClick={() => {
        if (!isFocused) void focusPane(node.pane_id)
      }}
    >
      {node.kind !== 'empty' && (
        <CodePaneHeader
          node={node}
          adapterId={terminalSummary?.adapter_id}
          isFocused={isFocused}
          isMaximized={isMaximized}
          terminalState={terminalSummary?.state}
          agentStatus={agentStatus}
          terminalHistoryEnabled={historyEnabled}
          terminalHistoryBusy={historyBusy}
          voiceState={hasTerminalVoice ? voiceState : null}
          onFocus={focusCurrentPane}
          onRename={(title) => renamePane(node.pane_id, title)}
          onSplitAndLaunch={(placement, kind, adapterId, model, url, agentLaunchMode) => {
            void splitAndLaunch(node.pane_id, placement, kind, adapterId, model, url, agentLaunchMode)
          }}
          onToggleMaximize={() => void toggleMaximize(node.pane_id)}
          onClose={() => void requestClosePane(node.pane_id)}
          onRelaunch={
            node.kind === 'terminal' || node.kind === 'coding_agent'
              ? () => {
                  void launchTerminal(node.pane_id, node.kind === 'coding_agent' ? 'coding_agent' : 'shell', terminalSummary?.adapter_id, terminalSummary?.model, terminalSummary?.agent_launch_mode)
                }
              : undefined
          }
          onOpenShellInstead={
            node.kind === 'coding_agent'
              ? () => {
                  void launchTerminal(node.pane_id, 'shell')
                }
              : undefined
          }
          onToggleTerminalHistory={
            node.kind === 'terminal' || node.kind === 'coding_agent'
              ? () => void toggleTerminalHistory()
              : undefined
          }
        />
      )}
      <CodePaneDropTargets
        paneId={node.pane_id}
        active={isDragActive && draggedPaneId !== node.pane_id}
      />
      <div className="code-pane-body">
        <PaneErrorBoundary>{renderContent()}</PaneErrorBoundary>
      </div>
    </div>
  )
}
