import React, { Component, type ReactNode } from 'react'
import type { CodePaneNode } from '../api/agentic-super-app-client'
import type { CodeWorkspaceController } from './state/use-code-workspace-controller'
import { CodePaneHeader } from './CodePaneHeader'
import { CodePaneDropTargets } from './CodePaneDropTargets'
import { CodePaneLauncher } from './CodePaneLauncher'
import { CodeTerminalPane } from './panes/CodeTerminalPane'
import { CodePreviewPane } from './panes/CodePreviewPane'
import { CodeThreadPane } from './panes/CodeThreadPane'

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
    createThread,
  } = controller
  const isFocused = state.focusedPaneId === node.pane_id
  const isMaximized = state.maximizedPaneId === node.pane_id

  const terminalSummary = node.resource_id ? state.terminals.get(node.resource_id) : undefined
  const previewSummary = node.resource_id ? state.previews.get(node.resource_id) : undefined

  const renderContent = () => {
    switch (node.kind) {
      case 'empty':
        return (
          <CodePaneLauncher
            paneId={node.pane_id}
            onLaunchShell={() => void launchTerminal(node.pane_id, 'shell')}
            onLaunchAgent={(adapterId, model) => void launchTerminal(node.pane_id, 'coding_agent', adapterId, model)}
            onOpenPreview={(url) => void openPreview(node.pane_id, url)}
            onCreateThread={() => void createThread(node.pane_id)}
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
              onCreateThread={() => void createThread(node.pane_id)}
            />
          )
        }
        return (
          <CodeTerminalPane
            terminalId={node.resource_id}
            summary={terminalSummary}
            onRelaunch={() => {
              void launchTerminal(node.pane_id, node.kind === 'coding_agent' ? 'coding_agent' : 'shell', terminalSummary?.adapter_id, terminalSummary?.model)
            }}
          />
        )
      case 'preview':
        return <CodePreviewPane preview={previewSummary} />
      case 'thread':
        if (!node.resource_id) return <div>No thread bound</div>
        return <CodeThreadPane conversationId={node.resource_id} />
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
