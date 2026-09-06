import React, { useEffect, useRef, useState } from 'react'
import { LayoutTemplate, Plus } from 'lucide-react'
import {
  hiveoryClient,
  type CodeAdapterSummary,
  type CodeAgentLaunchMode,
} from '../../../shared/api/hiveory-client'
import { CodeSplitPanePicker } from './CodeSplitPanePicker'
import { useBrowserSurfaceBlocker } from '../../browser/hooks/use-browser-surface-blocker'

interface CodePaneLauncherProps {
  onLaunch: (
    kind: 'shell' | 'coding_agent' | 'markdown' | 'preview',
    adapterId?: string | null,
    url?: string,
    agentLaunchMode?: CodeAgentLaunchMode,
  ) => void
}

export const CodePaneLauncher: React.FC<CodePaneLauncherProps> = ({ onLaunch }) => {
  const [adapters, setAdapters] = useState<CodeAdapterSummary[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [presetMessage, setPresetMessage] = useState<string | null>(null)
  const addPaneTriggerRef = useRef<HTMLButtonElement>(null)
  useBrowserSurfaceBlocker(pickerOpen, 'pane-launcher-dialog')

  useEffect(() => {
    let mounted = true
    void hiveoryClient.codeSnapshot().then((snapshot) => {
      if (mounted) setAdapters(snapshot.adapters.filter((adapter) => adapter.detected))
    })
    return () => {
      mounted = false
    }
  }, [])

  return (
    <div className="code-empty-pane">
      <div className="code-launcher-container">
        <div className="code-launcher-header">
          <h2>Start a workspace pane</h2>
          <p>Add a terminal, coding agent, Browser, or Markdown document.</p>
        </div>

        <div className="code-launcher-actions">
          <button
            ref={addPaneTriggerRef}
            type="button"
            className="code-launcher-card"
            aria-haspopup="menu"
            aria-expanded={pickerOpen}
            onClick={() => {
              setPresetMessage(null)
              setPickerOpen((open) => !open)
            }}
          >
            <span className="code-launcher-icon"><Plus size={18} aria-hidden="true" /></span>
            <span>
              <span className="code-launcher-card-title">Add pane</span>
              <span className="code-launcher-card-desc">Choose a terminal, agent, Browser, or document</span>
            </span>
          </button>
          <button
            type="button"
            className="code-launcher-card"
            onClick={() => {
              setPickerOpen(false)
              setPresetMessage('Pane presets are coming soon.')
            }}
          >
            <span className="code-launcher-icon"><LayoutTemplate size={18} aria-hidden="true" /></span>
            <span>
              <span className="code-launcher-card-title">Load presets</span>
              <span className="code-launcher-card-desc">Reuse a saved pane layout</span>
            </span>
          </button>
        </div>

        {presetMessage && <p className="code-launcher-status" role="status">{presetMessage}</p>}
      </div>

      <CodeSplitPanePicker
        open={pickerOpen}
        anchorRef={addPaneTriggerRef}
        adapters={adapters}
        mode="pane"
        onSelect={(kind, adapterId, url, agentLaunchMode) => onLaunch(kind, adapterId, url, agentLaunchMode)}
        onClose={() => setPickerOpen(false)}
      />
    </div>
  )
}
