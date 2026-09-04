import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Columns, FileText, Globe, Rows, Search, Terminal, X } from 'lucide-react'
import type { CodeAdapterSummary, CodePanePlacement } from '../../../shared/api/hiveory-client'
import { CliBrandIcon } from './CliIcons'
import { getSplitMenuPosition, type SplitMenuPosition } from './CodeSplitPanePicker.utils'

interface CodeSplitPanePickerProps {
  open: boolean
  anchorRef: { current: HTMLButtonElement | null }
  splitSide: Extract<CodePanePlacement, 'right' | 'bottom'>
  adapters: CodeAdapterSummary[]
  onSplitSideChange: (side: Extract<CodePanePlacement, 'right' | 'bottom'>) => void
  onSelect: (
    kind: 'shell' | 'coding_agent' | 'markdown' | 'preview',
    adapterId?: string | null,
    url?: string,
  ) => void
  onClose: () => void
}

interface SplitPaneOption {
  id: string
  title: string
  description: string
  kind: 'shell' | 'coding_agent' | 'markdown' | 'preview'
  adapterId?: string
  url?: string
  icon: React.ReactNode
}

export const CodeSplitPanePicker: React.FC<CodeSplitPanePickerProps> = ({
  open,
  anchorRef,
  splitSide,
  adapters,
  onSplitSideChange,
  onSelect,
  onClose,
}) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [position, setPosition] = useState<SplitMenuPosition | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) {
      setPosition(null)
      return
    }

    const updatePosition = () => {
      if (anchorRef.current) setPosition(getSplitMenuPosition(anchorRef.current.getBoundingClientRect(), window))
    }

    updatePosition()
    const frame = window.requestAnimationFrame(updatePosition)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [anchorRef, open])

  useEffect(() => {
    if (!open) {
      setQuery('')
      return
    }

    searchRef.current?.focus()
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onClose()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [anchorRef, onClose, open])

  const options = useMemo<SplitPaneOption[]>(() => [
    { id: 'terminal', title: 'Terminal', description: 'Interactive local shell', kind: 'shell' as const, icon: <Terminal size={16} /> },
    ...adapters.map((adapter) => ({
      id: `adapter:${adapter.id}`,
      title: adapter.display_name,
      description: 'Installed command-line agent',
      kind: 'coding_agent' as const,
      adapterId: adapter.id,
      icon: <CliBrandIcon identifier={adapter.id} size={16} />,
    })),
    { id: 'markdown', title: 'Markdown', description: 'Create a Markdown document', kind: 'markdown' as const, icon: <FileText size={16} /> },
    { id: 'preview', title: 'Browser', description: 'Open a local app or the web', kind: 'preview' as const, url: 'http://localhost:3000', icon: <Globe size={16} /> },
  ], [adapters])

  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return options
    return options.filter((option) => `${option.title} ${option.description}`.toLowerCase().includes(normalizedQuery))
  }, [options, query])

  if (!open || !position || typeof document === 'undefined') return null

  return createPortal(
    <div
      ref={menuRef}
      className="code-split-dropdown"
      role="menu"
      aria-label="Add split pane"
      style={{
        top: position.top,
        left: position.left,
        width: position.width,
        maxHeight: position.maxHeight,
        transform: position.above ? 'translateY(-100%)' : undefined,
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="code-split-dropdown-header">
        <span className="code-dialog-eyebrow">Add split pane</span>
        <span>Choose direction and pane type</span>
      </div>

      <div className="code-split-direction-tabs" role="group" aria-label="Split direction">
        <button
          type="button"
          className={`code-split-tab ${splitSide === 'right' ? 'is-active' : ''}`}
          onClick={() => onSplitSideChange('right')}
        >
          <Columns size={14} />
          <span>Split Right</span>
        </button>
        <button
          type="button"
          className={`code-split-tab ${splitSide === 'bottom' ? 'is-active' : ''}`}
          onClick={() => onSplitSideChange('bottom')}
        >
          <Rows size={14} />
          <span>Split Down</span>
        </button>
      </div>

      <label className="code-split-search">
        <Search size={14} aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search pane types…"
          aria-label="Search pane types"
        />
        {query && <button type="button" aria-label="Clear pane search" onClick={() => setQuery('')}><X size={13} /></button>}
      </label>

      <div className="code-split-dropdown-list">
        {filteredOptions.length ? filteredOptions.map((option) => (
          <button
            type="button"
            role="menuitem"
            key={option.id}
            className="code-split-modal-item"
            onClick={() => {
              onSelect(option.kind, option.adapterId ?? null, option.url)
              onClose()
            }}
          >
            <span className="code-split-item-icon">{option.icon}</span>
            <span className="code-split-item-text">
              <span className="code-split-item-title">{option.title}</span>
              <span className="code-split-item-desc">{option.description}</span>
            </span>
          </button>
        )) : (
          <div className="code-split-search-empty">No matching pane types</div>
        )}
      </div>
    </div>,
    document.body,
  )
}
