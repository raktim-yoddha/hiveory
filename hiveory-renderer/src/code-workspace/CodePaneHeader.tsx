import React, { useState, useRef, useEffect } from 'react'
import { useDraggable } from '@dnd-kit/core'
import {
  Globe,
  Plus,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  X,
  Columns,
  Rows,
  Terminal,
  MessageSquare,
  Settings2,
  LayoutTemplate,
} from 'lucide-react'
import {
  hiveoryClient,
  type CodeAdapterSummary,
  type CodePaneNode,
  type CodePanePlacement,
  type CodeTerminalState,
} from '../api/hiveory-client'
import { CodePaneMenu } from './CodePaneMenu'
import { CliBrandIcon } from './CliIcons'

interface CodePaneHeaderProps {
  node: CodePaneNode
  isFocused: boolean
  isMaximized: boolean
  terminalState?: CodeTerminalState
  onFocus: () => void
  onRename: (newTitle: string) => void
  onSplitAndLaunch: (
    placement: CodePanePlacement,
    kind: 'shell' | 'coding_agent' | 'thread' | 'preview',
    adapterId?: string | null,
    model?: string | null,
    url?: string
  ) => void
  onToggleMaximize: () => void
  onClose: () => void
  onRelaunch?: () => void
  onOpenShellInstead?: () => void
}

export const CodePaneHeader: React.FC<CodePaneHeaderProps> = ({
  node,
  isFocused,
  isMaximized,
  onFocus,
  onRename,
  onSplitAndLaunch,
  onToggleMaximize,
  onClose,
  onRelaunch,
  onOpenShellInstead,
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const [titleValue, setTitleValue] = useState(node.title || '')
  const [menuOpen, setMenuOpen] = useState(false)
  const [splitModalOpen, setSplitModalOpen] = useState(false)
  const [splitSide, setSplitSide] = useState<CodePanePlacement>('right')
  const [adapters, setAdapters] = useState<CodeAdapterSummary[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `pane:${node.pane_id}`,
    data: { paneId: node.pane_id },
  })

  useEffect(() => {
    setTitleValue(node.title || '')
  }, [node.title])

  useEffect(() => {
    let mounted = true
    void hiveoryClient.codeSnapshot().then((snapshot) => {
      if (mounted) setAdapters(snapshot.adapters.filter((a) => a.detected))
    })
    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [isEditing])

  useEffect(() => {
    const handleRenameFocusedPane = () => {
      if (isFocused) setIsEditing(true)
    }
    window.addEventListener('hiveory-rename-focused-pane', handleRenameFocusedPane)
    return () => window.removeEventListener('hiveory-rename-focused-pane', handleRenameFocusedPane)
  }, [isFocused])

  const handleCommitRename = () => {
    setIsEditing(false)
    const trimmed = titleValue.trim()
    if (trimmed && trimmed !== node.title) {
      onRename(trimmed)
    } else {
      setTitleValue(node.title || '')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCommitRename()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
      setTitleValue(node.title || '')
    }
  }

  const showPaneActions = node.kind !== 'empty'

  const getPaneIcon = () => {
    switch (node.kind) {
      case 'coding_agent':
        return <CliBrandIcon identifier={node.title} size={13} />
      case 'terminal':
        return <Terminal size={13} style={{ color: '#9ca3af' }} aria-hidden="true" />
      case 'preview':
        return <Globe size={13} style={{ color: '#aeb7c2' }} />
      case 'thread':
        return <Settings2 size={13} style={{ color: '#9ca3af' }} aria-hidden="true" />
      default:
        return <LayoutTemplate size={13} style={{ color: '#9ca3af' }} aria-hidden="true" />
    }
  }

  const defaultTitle = () => {
    switch (node.kind) {
      case 'coding_agent':
        return 'Claude Code'
      case 'terminal':
        return 'zsh'
      case 'preview':
        return 'localhost:3000'
      case 'thread':
        return 'Thread'
      default:
        return 'New pane'
    }
  }

  return (
    <>
      <div
        className={`code-pane-header ${isFocused ? 'focused' : ''}`}
        onClick={onFocus}
      >
        <div
          ref={setNodeRef}
          {...attributes}
          {...listeners}
          className={`code-pane-header-left code-pane-drag-handle ${isDragging ? 'is-dragging' : ''}`}
          data-dragging={isDragging ? 'true' : 'false'}
          title="Drag to move pane"
        >
          <span className="code-live-dot" />
          <span className="code-pane-header-icon">{getPaneIcon()}</span>

          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              className="code-pane-rename-input"
              value={titleValue}
              onChange={(e) => setTitleValue(e.target.value)}
              onBlur={handleCommitRename}
              onKeyDown={handleKeyDown}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span
              className="code-pane-title"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setIsEditing(true)
              }}
              title="Double-click or press F2 to rename"
            >
              {node.title || defaultTitle()}
            </span>
          )}
        </div>

        {showPaneActions && <div className="code-pane-header-actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {/* More Options Menu */}
          <div style={{ position: 'relative' }}>
            <button
              className="code-pane-action-btn"
              title="More Options"
              aria-label="More Options"
              onClick={() => setMenuOpen(!menuOpen)}
            >
              <MoreHorizontal size={13} />
            </button>
            {menuOpen && (
              <CodePaneMenu
                node={node}
                isMaximized={isMaximized}
                onClose={() => setMenuOpen(false)}
                onRename={() => setIsEditing(true)}
                onToggleMaximize={onToggleMaximize}
                onRelaunch={onRelaunch}
                onOpenShellInstead={onOpenShellInstead}
                onClosePane={onClose}
              />
            )}
          </div>

          {/* Maximize / Restore */}
          <button
            className="code-pane-action-btn"
            title={isMaximized ? 'Restore Pane' : 'Maximize Pane'}
            aria-label={isMaximized ? 'Restore Pane' : 'Maximize Pane'}
            onClick={onToggleMaximize}
          >
            {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>

          {/* Plus Button — Triggers Centered Screen Pop-up Menu */}
          <button
            className="code-pane-action-btn"
            title="Add Split Pane"
            aria-label="Add Split Pane"
            onClick={() => setSplitModalOpen(true)}
          >
            <Plus size={13} />
          </button>

          {/* Close Button */}
          <button
            className="code-pane-action-btn"
            title="Close Pane (Ctrl+W)"
            aria-label="Close Pane"
            onClick={onClose}
          >
            <X size={13} />
          </button>
        </div>}
      </div>

      {/* Centered Pop-up Modal for Split Pane Creation */}
      {splitModalOpen && (
        <div
          className="code-launch-dialog-backdrop"
          role="presentation"
          onMouseDown={() => setSplitModalOpen(false)}
        >
          <div
            className="code-split-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="code-split-modal-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="code-split-modal-header">
              <div>
                <span className="code-dialog-eyebrow">Workspace Split</span>
                <h3 id="code-split-modal-title">Add Split Pane</h3>
              </div>
              <button
                type="button"
                className="code-pane-action-btn"
                onClick={() => setSplitModalOpen(false)}
                aria-label="Close"
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>

            <div className="code-split-direction-tabs large">
              <button
                type="button"
                className={`code-split-tab ${splitSide === 'right' ? 'is-active' : ''}`}
                onClick={() => setSplitSide('right')}
              >
                <Columns size={14} />
                <span>Split Right</span>
              </button>
              <button
                type="button"
                className={`code-split-tab ${splitSide === 'bottom' ? 'is-active' : ''}`}
                onClick={() => setSplitSide('bottom')}
              >
                <Rows size={14} />
                <span>Split Down</span>
              </button>
            </div>

            <div className="code-split-modal-list">
              <button
                type="button"
                className="code-split-modal-item"
                onClick={() => {
                  onSplitAndLaunch(splitSide, 'shell')
                  setSplitModalOpen(false)
                }}
              >
                <span className="code-split-item-icon">
                  <Terminal size={16} />
                </span>
                <div className="code-split-item-text">
                  <span className="code-split-item-title">Terminal</span>
                  <span className="code-split-item-desc">Interactive local shell</span>
                </div>
              </button>

              {adapters.map((adapter) => (
                <button
                  type="button"
                  key={adapter.id}
                  className="code-split-modal-item"
                  onClick={() => {
                    onSplitAndLaunch(splitSide, 'coding_agent', adapter.id)
                    setSplitModalOpen(false)
                  }}
                >
                  <span className="code-split-item-icon">
                    <CliBrandIcon identifier={adapter.id} size={16} />
                  </span>
                  <div className="code-split-item-text">
                    <span className="code-split-item-title">{adapter.display_name}</span>
                    <span className="code-split-item-desc">Installed command-line agent</span>
                  </div>
                </button>
              ))}

              <button
                type="button"
                className="code-split-modal-item"
                onClick={() => {
                  onSplitAndLaunch(splitSide, 'thread')
                  setSplitModalOpen(false)
                }}
              >
                <span className="code-split-item-icon">
                  <MessageSquare size={16} />
                </span>
                <div className="code-split-item-text">
                  <span className="code-split-item-title">Thread</span>
                  <span className="code-split-item-desc">Docked workspace conversation</span>
                </div>
              </button>

              <button
                type="button"
                className="code-split-modal-item"
                onClick={() => {
                  onSplitAndLaunch(splitSide, 'preview', null, null, 'http://localhost:3000')
                  setSplitModalOpen(false)
                }}
              >
                <span className="code-split-item-icon">
                  <Globe size={16} />
                </span>
                <div className="code-split-item-text">
                  <span className="code-split-item-title">Preview</span>
                  <span className="code-split-item-desc">Open local web app</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
