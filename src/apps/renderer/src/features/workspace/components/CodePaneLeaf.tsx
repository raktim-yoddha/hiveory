import React, { Component, useEffect, useState, type ReactNode } from 'react'
import { hiveoryClient, type BrowserRuntimeState, type CodePaneNode } from '../../../shared/api/hiveory-client'
import type { CodeWorkspaceController } from '../state/use-code-workspace-controller'
import { CodePaneHeader } from './CodePaneHeader'
import { CodePaneDropTargets } from './CodePaneDropTargets'
import { CodePaneLauncher } from './CodePaneLauncher'
import { CodeTerminalPane } from './panes/CodeTerminalPane'
import { CodePreviewPane } from './panes/CodePreviewPane'
import { CodeMarkdownPane } from './panes/CodeMarkdownPane'

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

  const terminalSummary = node.resource_id ? state.terminals.get(node.resource_id) : undefined
  const previewSummary = node.resource_id ? state.previews.get(node.resource_id) : undefined

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
            paneId={node.pane_id}
            onLaunchShell={() => void launchTerminal(node.pane_id, 'shell')}
            onLaunchAgent={(adapterId, model) => void launchTerminal(node.pane_id, 'coding_agent', adapterId, model)}
            onOpenPreview={(url) => void openPreview(node.pane_id, url)}
            onCreateMarkdown={() => void createMarkdown(node.pane_id)}
          />
        )
      case 'terminal':
      case 'coding_agent':
        if (!node.resource_id || !terminalSummary) {
          return (
            <CodePaneLauncher
              paneId={node.pane_id}
              onLaunchShell={() => void launchTerminal(node.pane_id, 'shell')}
              onLaunchAgent={(adapterId, model) => void launchTerminal(node.pane_id, 'coding_agent', adapterId, model)}
              onOpenPreview={(url) => void openPreview(node.pane_id, url)}
              onCreateMarkdown={() => void createMarkdown(node.pane_id)}
            />
          )
        }
        return (
          <CodeTerminalPane
            terminalId={node.resource_id}
            summary={terminalSummary}
            historyError={historyError}
            onDismissHistoryError={() => setHistoryError(null)}
            onRelaunch={() => {
              void launchTerminal(node.pane_id, node.kind === 'coding_agent' ? 'coding_agent' : 'shell', terminalSummary?.adapter_id, terminalSummary?.model)
            }}
          />
        )
      case 'preview':
        if (!previewSummary) return <div className="code-preview-native-placeholder">Loading Browser…</div>
        return (
          <CodePreviewPane
            key={previewSummary.id}
            workspaceId={state.workspaceId ?? previewSummary.workspace_id}
            preview={previewSummary}
            onStateChange={(nextState: BrowserRuntimeState) => updatePreviewState(nextState)}
          />
        )
      case 'markdown':
        if (!node.resource_id || !state.workspaceId) return <div className="code-pane-empty-message">No Markdown document bound</div>
        return (
          <CodeMarkdownPane
            key={node.resource_id}
            workspaceId={state.workspaceId}
            relativePath={node.resource_id}
            onOpenMarkdown={(path) => void openMarkdown(node.pane_id, path)}
            onCreateMarkdown={() => void createMarkdown(node.pane_id)}
            onRenameMarkdown={(path, fingerprint) => renameMarkdown(node.pane_id, node.resource_id!, path, fingerprint)}
          />
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
          isFocused={isFocused}
          isMaximized={isMaximized}
          terminalState={terminalSummary?.state}
          terminalHistoryEnabled={historyEnabled}
          terminalHistoryBusy={historyBusy}
          onFocus={() => void focusPane(node.pane_id)}
          onRename={(title) => void renamePane(node.pane_id, title)}
          onSplitAndLaunch={(placement, kind, adapterId, model, url) => {
            void splitAndLaunch(node.pane_id, placement, kind, adapterId, model, url)
          }}
          onToggleMaximize={() => void toggleMaximize(node.pane_id)}
          onClose={() => void requestClosePane(node.pane_id)}
          onRelaunch={
            node.kind === 'terminal' || node.kind === 'coding_agent'
              ? () => {
                  void launchTerminal(node.pane_id, node.kind === 'coding_agent' ? 'coding_agent' : 'shell', terminalSummary?.adapter_id, terminalSummary?.model)
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
