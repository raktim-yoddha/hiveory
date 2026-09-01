import React, { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import type { CodePanePreset } from '../../shared/api/hiveory-client'
import { PRIMARY_PRESETS } from './code-layout-presets-meta'

interface CodeLayoutPresetsProps {
  onSelectPreset: (preset: CodePanePreset) => void
  onClose: () => void
  paneCount?: number
}

export const CodeLayoutPresets: React.FC<CodeLayoutPresetsProps> = ({
  onSelectPreset,
  onClose,
  paneCount = 1,
}) => {
  const modalRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose])

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
          {PRIMARY_PRESETS.map((preset) => {
            const disabled = paneCount > preset.maxPanes
            return (
              <button
                key={preset.id}
                onClick={() => {
                  if (!disabled) {
                    onSelectPreset(preset.id)
                    onClose()
                  }
                }}
                disabled={disabled}
                aria-disabled={disabled}
                className={`code-preset-card ${disabled ? 'is-disabled' : ''}`}
                title={
                  disabled
                    ? `${preset.label}: Supports up to ${preset.maxPanes} panes (current: ${paneCount})`
                    : preset.description
                }
              >
                <div>
                  <div className="code-preset-label">{preset.label}</div>
                  <div className="code-preset-description">
                    {disabled ? `Max ${preset.maxPanes} panes` : preset.description}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
