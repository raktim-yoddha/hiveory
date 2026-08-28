import React, { useState, useRef, useEffect } from 'react'
import {
  Globe,
  Plus,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  X,
} from 'lucide-react'
import type { CodePaneNode, CodeTerminalState } from '../api/agentic-super-app-client'
import { CodePaneMenu } from './CodePaneMenu'

interface CodePaneHeaderProps {
  node: CodePaneNode
  isFocused: boolean
  isMaximized: boolean
  terminalState?: CodeTerminalState
  onFocus: () => void
  onRename: (newTitle: string) => void
  onSplit: () => void
  onSplitDown: () => void
  onToggleMaximize: () => void
  onClose: () => void
  onRelaunch?: () => void
  onOpenShellInstead?: () => void
  onDragStart?: (event: React.DragEvent<HTMLDivElement>) => void
  onDragEnd?: () => void
}

export const CodePaneHeader: React.FC<CodePaneHeaderProps> = ({
  node,
  isFocused,
  isMaximized,
  onFocus,
  onRename,
  onSplit,
  onSplitDown,
  onToggleMaximize,
  onClose,
  onRelaunch,
  onOpenShellInstead,
  onDragStart,
  onDragEnd,
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const [titleValue, setTitleValue] = useState(node.title || '')
  const [menuOpen, setMenuOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setTitleValue(node.title || '')
  }, [node.title])

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
    window.addEventListener('agentic-super-app-rename-focused-pane', handleRenameFocusedPane)
    return () => window.removeEventListener('agentic-super-app-rename-focused-pane', handleRenameFocusedPane)
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

  const getPaneIcon = () => {
    switch (node.kind) {
      case 'coding_agent':
        return <span style={{ color: '#f59e0b', fontSize: 13, fontWeight: 700 }}>✳</span>
      case 'terminal':
        return <span style={{ color: '#9ca3af', fontSize: 12, fontWeight: 600 }}>🔲</span>
      case 'preview':
        return <Globe size={13} style={{ color: '#60a5fa' }} />
      case 'thread':
        return <span style={{ color: '#9ca3af', fontSize: 12 }}>⚙</span>
      default:
        return <span style={{ color: '#9ca3af', fontSize: 12 }}>✳</span>
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
    <div
      className={`code-pane-header ${isFocused ? 'focused' : ''}`}
      onClick={onFocus}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
    >
      <div className="code-pane-header-left">
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

      <div className="code-pane-header-actions" onClick={(e) => e.stopPropagation()}>
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
              onSplitRight={onSplit}
              onSplitDown={onSplitDown}
              onToggleMaximize={onToggleMaximize}
              onRelaunch={onRelaunch}
              onOpenShellInstead={onOpenShellInstead}
              onClosePane={onClose}
            />
          )}
        </div>

        <button
          className="code-pane-action-btn"
          title={isMaximized ? 'Restore Pane' : 'Maximize Pane'}
          aria-label={isMaximized ? 'Restore Pane' : 'Maximize Pane'}
          onClick={onToggleMaximize}
        >
          {isMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
        </button>

        <button
          className="code-pane-action-btn"
          title="Split Pane Right"
          aria-label="Split Right"
          onClick={onSplit}
        >
          <Plus size={13} />
        </button>

        <button
          className="code-pane-action-btn"
          title="Close Pane (Ctrl+W)"
          aria-label="Close Pane"
          onClick={onClose}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  )
}
