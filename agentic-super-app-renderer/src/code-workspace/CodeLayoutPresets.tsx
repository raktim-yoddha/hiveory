import React, { useEffect, useRef } from 'react'
import { Columns, Rows, LayoutGrid, Sparkles, Layout, X } from 'lucide-react'
import type { CodePanePreset } from '../api/agentic-super-app-client'

interface CodeLayoutPresetsProps {
  onSelectPreset: (preset: CodePanePreset) => void
  onClose: () => void
}

export const CodeLayoutPresets: React.FC<CodeLayoutPresetsProps> = ({
  onSelectPreset,
  onClose,
}) => {
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [onClose])

  const presets: { id: CodePanePreset; label: string; desc: string; icon: React.ReactNode }[] = [
    { id: 'tidy', label: 'Tidy', desc: 'Normalize layout cleanly (Ctrl+Shift+T)', icon: <Sparkles size={16} /> },
    { id: 'equal_columns', label: 'Equal Columns', desc: 'Distribute panes in vertical columns', icon: <Columns size={16} /> },
    { id: 'equal_rows', label: 'Equal Rows', desc: 'Distribute panes in horizontal rows', icon: <Rows size={16} /> },
    { id: 'main_left', label: 'Main Left', desc: 'Large primary pane on left, stacked on right', icon: <Layout size={16} /> },
    { id: 'main_top', label: 'Main Top', desc: 'Large primary pane on top, stacked below', icon: <Layout className="code-preset-icon-rotated" size={16} /> },
    { id: 'grid', label: 'Grid (2x2 / 3x2)', desc: 'Balanced 2D grid arrangement', icon: <LayoutGrid size={16} /> },
  ]

  return (
    <div className="code-presets-backdrop">
      <div ref={modalRef} className="code-presets-modal">
        <div className="code-presets-heading">
          <span>Layout presets</span>
          <button className="code-icon-button" onClick={onClose} aria-label="Close layout presets">
            <X size={15} />
          </button>
        </div>

        <div className="code-presets-grid">
          {presets.map((preset) => (
            <button
              key={preset.id}
              onClick={() => {
                onSelectPreset(preset.id)
                onClose()
              }}
              className="code-preset-card"
            >
              <div className="code-preset-icon">{preset.icon}</div>
              <div>
                <div className="code-preset-label">{preset.label}</div>
                <div className="code-preset-description">{preset.desc}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
