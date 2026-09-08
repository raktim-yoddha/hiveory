import React, { useState, useRef, useEffect } from 'react'
import { useDraggable } from '@dnd-kit/core'
import {
  Globe,
  Plus,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  X,
  Terminal,
  FileText,
  LayoutTemplate,
  Mic,
  MicOff,
} from 'lucide-react'
import {
  hiveoryClient,
  type CodeAdapterSummary,
  type CodeAgentLaunchMode,
  type CodePaneNode,
  type CodePanePlacement,
  type CodeTerminalState,
} from '../../../shared/api/hiveory-client'
import { CodePaneMenu } from './CodePaneMenu'
import { CodeSplitPanePicker } from './CodeSplitPanePicker'
import { CliBrandIcon } from './CliIcons'
import type { CodeTerminalVoiceState } from './panes/CodeTerminalPane'
import { useBrowserSurfaceBlocker } from '../../browser/hooks/use-browser-surface-blocker'

interface CodePaneHeaderProps {
  node: CodePaneNode
  adapterId?: string | null
  isFocused: boolean
  isMaximized: boolean
  terminalState?: CodeTerminalState
  terminalHistoryEnabled?: boolean
  terminalHistoryBusy?: boolean
  voiceState?: CodeTerminalVoiceState | null
  onFocus: () => void
  onRename: (newTitle: string) => void
  onSplitAndLaunch: (
    placement: CodePanePlacement,
    kind: 'shell' | 'coding_agent' | 'markdown' | 'preview',
    adapterId?: string | null,
    model?: string | null,
    url?: string,
    agentLaunchMode?: CodeAgentLaunchMode,
  ) => void
  onToggleMaximize: () => void
  onClose: () => void
  onRelaunch?: () => void
  onOpenShellInstead?: () => void
  onToggleTerminalHistory?: () => void
}

const ADAPTER_CACHE_TTL_MS = 30_000
let adapterCache: { adapters: CodeAdapterSummary[]; expiresAt: number } | null = null
let adapterRequest: Promise<CodeAdapterSummary[]> | null = null

const loadDetectedAdapters = async (): Promise<CodeAdapterSummary[]> => {
  if (adapterCache && adapterCache.expiresAt > Date.now()) return adapterCache.adapters
  if (!adapterRequest) {
    adapterRequest = hiveoryClient.codeSnapshot()
      .then((snapshot) => {
        const adapters = snapshot.adapters.filter((adapter) => adapter.detected)
        adapterCache = { adapters, expiresAt: Date.now() + ADAPTER_CACHE_TTL_MS }
        return adapters
      })
      .finally(() => {
        adapterRequest = null
      })
  }
  return adapterRequest
}

export const CodePaneHeader: React.FC<CodePaneHeaderProps> = ({
  node,
  adapterId,
  isFocused,
  isMaximized,
  terminalState,
  onFocus,
  onRename,
  onSplitAndLaunch,
  onToggleMaximize,
  onClose,
  onRelaunch,
  onOpenShellInstead,
  terminalHistoryEnabled,
  terminalHistoryBusy,
  onToggleTerminalHistory,
  voiceState,
}) => {
  const [isEditing, setIsEditing] = useState(false)
  const [titleValue, setTitleValue] = useState(node.title || '')
  const [menuOpen, setMenuOpen] = useState(false)
  const [splitMenuOpen, setSplitMenuOpen] = useState(false)
  const [splitSide, setSplitSide] = useState<Extract<CodePanePlacement, 'right' | 'bottom'>>('right')
  const [adapters, setAdapters] = useState<CodeAdapterSummary[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const splitTriggerRef = useRef<HTMLButtonElement>(null)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `pane:${node.pane_id}`,
    data: { paneId: node.pane_id },
  })

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
    window.addEventListener('hiveory-rename-focused-pane', handleRenameFocusedPane)
    return () => window.removeEventListener('hiveory-rename-focused-pane', handleRenameFocusedPane)
  }, [isFocused])

  useBrowserSurfaceBlocker(menuOpen || splitMenuOpen, 'pane-header-menu')

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
      e.preventDefault()
      e.stopPropagation()
      handleCommitRename()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      setIsEditing(false)
      setTitleValue(node.title || '')
    }
  }

  const showPaneActions = node.kind !== 'empty'

  const getPaneIcon = () => {
    switch (node.kind) {
      case 'coding_agent':
        return <CliBrandIcon identifier={adapterId} size={13} />
      case 'terminal':
        return <Terminal size={13} style={{ color: '#9ca3af' }} aria-hidden="true" />
      case 'preview':
        return <Globe size={13} style={{ color: '#aeb7c2' }} />
      case 'markdown':
        return <FileText size={13} style={{ color: '#9ca3af' }} aria-hidden="true" />
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
        return 'Browser'
      case 'markdown':
        return 'Markdown'
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
          className="code-pane-header-left"
        >
          <span
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            className={`code-pane-drag-grip code-pane-drag-handle ${isDragging ? 'is-dragging' : ''} ${isEditing ? 'is-editing' : ''}`}
            data-dragging={isDragging ? 'true' : 'false'}
            title={isEditing ? 'Drag to move pane' : 'Hold and drag to move pane'}
            aria-label="Drag pane"
          >
            <span className="code-live-dot" />
            <span className="code-pane-header-icon">{getPaneIcon()}</span>

            {!isEditing && (
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
          </span>

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
          ) : null}
        </div>

        {showPaneActions && <div className="code-pane-header-actions" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
          {voiceState && (
            <button
              type="button"
              className={`code-pane-action-btn code-pane-voice-btn${voiceState.listening ? ' is-listening' : ''}`}
              title={!voiceState.supported ? 'Speech recognition is unavailable in this runtime' : voiceState.listening ? 'Stop voice dictation' : 'Dictate into terminal'}
              aria-label={!voiceState.supported ? 'Speech recognition unavailable' : voiceState.listening ? 'Stop voice dictation' : 'Start voice dictation'}
              aria-pressed={voiceState.listening}
              disabled={!voiceState.supported || terminalState === 'interrupted' || terminalState === 'failed' || terminalState === 'exited' || terminalState === 'dormant'}
              onClick={voiceState.toggle}
            >
              {voiceState.listening ? <Mic size={13} /> : <MicOff size={13} />}
            </button>
          )}
          {/* More Options Menu */}
          <div style={{ position: 'relative' }}>
            <button
              className="code-pane-action-btn"
              title="More Options"
              aria-label="More Options"
              onClick={() => {
                setSplitMenuOpen(false)
                setMenuOpen(!menuOpen)
              }}
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
                terminalHistoryEnabled={terminalHistoryEnabled}
                terminalHistoryBusy={terminalHistoryBusy}
                onToggleTerminalHistory={onToggleTerminalHistory}
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

          <div className="code-pane-menu-wrap">
            <button
              ref={splitTriggerRef}
              className="code-pane-action-btn"
              title="Add Split Pane"
              aria-label="Add Split Pane"
              aria-haspopup="menu"
              aria-expanded={splitMenuOpen}
              onClick={() => {
                setMenuOpen(false)
                setSplitMenuOpen((open) => {
                  const nextOpen = !open
                  if (nextOpen && adapters.length === 0) {
                    void loadDetectedAdapters().then(setAdapters).catch(() => undefined)
                  }
                  return nextOpen
                })
              }}
            >
              <Plus size={13} />
            </button>
          </div>

          <CodeSplitPanePicker
            open={splitMenuOpen}
            anchorRef={splitTriggerRef}
            splitSide={splitSide}
            adapters={adapters}
            onSplitSideChange={(side) => setSplitSide(side)}
            onSelect={(kind, adapterId, url, agentLaunchMode) => onSplitAndLaunch(splitSide, kind, adapterId, null, url, agentLaunchMode)}
            onClose={() => setSplitMenuOpen(false)}
          />

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

    </>
  )
}
