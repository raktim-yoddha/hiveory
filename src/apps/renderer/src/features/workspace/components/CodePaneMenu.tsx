import React, { useEffect, useRef } from 'react'
import {
  Maximize2,
  Minimize2,
  Edit2,
  Trash2,
  Terminal,
  RotateCw,
} from 'lucide-react'
import type { CodePaneNode } from '../../../shared/api/hiveory-client'

interface CodePaneMenuProps {
  node: CodePaneNode
  isMaximized: boolean
  onClose: () => void
  onRename: () => void
  onToggleMaximize: () => void
  onRelaunch?: () => void
  onOpenShellInstead?: () => void
  onClosePane: () => void
}

export const CodePaneMenu: React.FC<CodePaneMenuProps> = ({
  node,
  isMaximized,
  onClose,
  onRename,
  onToggleMaximize,
  onRelaunch,
  onOpenShellInstead,
  onClosePane,
}) => {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  const isTerminalOrAgent = node.kind === 'terminal' || node.kind === 'coding_agent'

  return (
    <div className="code-dropdown-menu" ref={menuRef} role="menu">
      {isTerminalOrAgent && onRelaunch && (
        <button
          className="code-dropdown-item"
          onClick={() => {
            onRelaunch()
            onClose()
          }}
        >
          <RotateCw size={13} />
          <span>Relaunch</span>
        </button>
      )}

      {node.kind === 'coding_agent' && onOpenShellInstead && (
        <button
          className="code-dropdown-item"
          onClick={() => {
            onOpenShellInstead()
            onClose()
          }}
        >
          <Terminal size={13} />
          <span>Open shell instead</span>
        </button>
      )}

      {isTerminalOrAgent && <div className="code-dropdown-divider" />}

      <button
        className="code-dropdown-item"
        onClick={() => {
          onToggleMaximize()
          onClose()
        }}
      >
        {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        <span>{isMaximized ? 'Restore' : 'Maximize'}</span>
      </button>

      <button
        className="code-dropdown-item"
        onClick={() => {
          onRename()
          onClose()
        }}
      >
        <Edit2 size={13} />
        <span>Rename (F2)</span>
      </button>

      <div className="code-dropdown-divider" />

      <button
        className="code-dropdown-item danger"
        onClick={() => {
          onClosePane()
          onClose()
        }}
      >
        <Trash2 size={13} />
        <span>Close Pane (Ctrl+W)</span>
      </button>
    </div>
  )
}
