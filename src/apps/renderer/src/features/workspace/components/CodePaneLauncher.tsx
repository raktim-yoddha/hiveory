import React, { useEffect, useRef, useState } from 'react'
import { LayoutTemplate, Plus } from 'lucide-react'
import {
  hiveoryClient,
  type CodeAdapterSummary,
  type CodeAgentLaunchMode,
  type CodeLaunchPresetSummary,
} from '../../../shared/api/hiveory-client'
import { CodeSplitPanePicker } from './CodeSplitPanePicker'
import { CodeLayoutPresetLibrary } from './CodeLayoutPresetLibrary'
import { useBrowserSurfaceBlocker } from '../../browser/hooks/use-browser-surface-blocker'

interface CodePaneLauncherProps {
  workspaceId: string
  allowPresets: boolean
  onLaunch: (
    kind: 'shell' | 'coding_agent' | 'markdown' | 'preview',
    adapterId?: string | null,
    url?: string,
    agentLaunchMode?: CodeAgentLaunchMode,
  ) => void
  onOpenPreset: (preset: CodeLaunchPresetSummary) => Promise<void>
}

export const CodePaneLauncher: React.FC<CodePaneLauncherProps> = ({ workspaceId, allowPresets, onLaunch, onOpenPreset }) => {
  const [adapters, setAdapters] = useState<CodeAdapterSummary[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [presetOpen, setPresetOpen] = useState(false)
  const addPaneTriggerRef = useRef<HTMLButtonElement>(null)
  useBrowserSurfaceBlocker(pickerOpen || presetOpen, 'pane-launcher-dialog')

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
              setPickerOpen((open) => !open)
            }}
          >
            <span className="code-launcher-icon"><Plus size={18} aria-hidden="true" /></span>
            <span>
              <span className="code-launcher-card-title">Add pane</span>
              <span className="code-launcher-card-desc">Choose a terminal, agent, Browser, or document</span>
            </span>
          </button>
          {allowPresets && <button
            type="button"
            className="code-launcher-card"
            onClick={() => {
              setPickerOpen(false)
              setPresetOpen(true)
            }}
          >
            <span className="code-launcher-icon"><LayoutTemplate size={18} aria-hidden="true" /></span>
            <span>
              <span className="code-launcher-card-title">Load presets</span>
              <span className="code-launcher-card-desc">Open a saved workspace setup</span>
            </span>
          </button>}
        </div>

      </div>

      <CodeSplitPanePicker
        open={pickerOpen}
        anchorRef={addPaneTriggerRef}
        adapters={adapters}
        mode="pane"
        onSelect={(kind, adapterId, url, agentLaunchMode) => onLaunch(kind, adapterId, url, agentLaunchMode)}
        onClose={() => setPickerOpen(false)}
      />
      {presetOpen && <CodeLayoutPresetLibrary workspaceId={workspaceId} adapters={adapters} onOpenPreset={onOpenPreset} onClose={() => setPresetOpen(false)} />}
    </div>
  )
}
