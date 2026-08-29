import React, { useEffect, useState, useCallback, type ReactNode } from 'react'
import {
  agenticSuperAppClient,
  type CodeProjectSummary,
  type CodeWorkspaceCreateRequest,
  type CodeWorkspaceSummary,
} from '../api/agentic-super-app-client'
import { useCodeWorkspaceController } from './state/use-code-workspace-controller'
import { CodeWorkspaceRail } from './CodeWorkspaceRail'
import { CodePaneCanvas } from './CodePaneCanvas'
import { AgenticSuperAppCodeDashboard } from './AgenticSuperAppCodeDashboard'
import { AgenticSuperAppCodeRoutines } from './AgenticSuperAppCodeRoutines'
import { AgenticSuperAppCodePlugins } from './AgenticSuperAppCodePlugins'
import { AgenticSuperAppCodeSkills } from './AgenticSuperAppCodeSkills'
import { CodeWorkspaceCreateDialog } from './CodeWorkspaceDialogs'
import './code-workspace.css'

interface AgenticSuperAppCodeWorkspaceProps {
  initialWorkspaceId?: string | null
  initialSection?: 'dashboard' | 'routines' | 'plugins' | 'skills' | 'workspace'
  children?: ReactNode
}

export const AgenticSuperAppCodeWorkspace: React.FC<AgenticSuperAppCodeWorkspaceProps> = ({
  initialWorkspaceId,
  initialSection = 'workspace',
}) => {
  const [projects, setProjects] = useState<CodeProjectSummary[]>([])
  const [workspaces, setWorkspaces] = useState<CodeWorkspaceSummary[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(initialWorkspaceId ?? null)
  const [activeSection, setActiveSection] = useState<'dashboard' | 'routines' | 'plugins' | 'skills' | 'workspace'>(initialSection)
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false)
  const [createWorkspaceProjectId, setCreateWorkspaceProjectId] = useState<string | null>(null)
  const [createWorkspaceBusy, setCreateWorkspaceBusy] = useState(false)
  const [createWorkspaceError, setCreateWorkspaceError] = useState<string | null>(null)

  const controller = useCodeWorkspaceController(activeWorkspaceId)
  const { loadWorkspace, applyPreset, requestClosePane, toggleMaximize, focusPane, setError, state } = controller

  const refreshWorkspaces = useCallback(async () => {
    try {
      const snapshot = await agenticSuperAppClient.codeSnapshot()
      setProjects(snapshot.projects)
      setWorkspaces(snapshot.workspaces)
      const availableWorkspace = snapshot.workspaces.find((workspace) => workspace.available)
      if (!activeWorkspaceId && availableWorkspace) {
        const firstId = snapshot.active_workspace_id && snapshot.workspaces.some((workspace) => workspace.id === snapshot.active_workspace_id && workspace.available)
          ? snapshot.active_workspace_id
          : availableWorkspace.id
        setActiveWorkspaceId(firstId)
        void loadWorkspace(firstId)
      }
    } catch {
      // ignore snapshot error
    }
  }, [activeWorkspaceId, loadWorkspace])

  useEffect(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  const handleSelectWorkspace = (wsId: string) => {
    setActiveWorkspaceId(wsId)
    setActiveSection('workspace')
    void loadWorkspace(wsId)
  }

  const handleAddProject = async () => {
    const path = await agenticSuperAppClient.chooseWorkspacePath()
    if (!path) return
    try {
      const detail = await agenticSuperAppClient.addCodeProject(path)
      setActiveWorkspaceId(detail.summary.id)
      setActiveSection('workspace')
      await refreshWorkspaces()
      void loadWorkspace(detail.summary.id)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
    }
  }

  const handleAddWorkspace = (projectId?: string) => {
    const fallbackProjectId = workspaces.find((workspace) => workspace.id === activeWorkspaceId)?.project_id ?? projects.find((project) => project.kind === 'git' && project.available)?.id ?? null
    setCreateWorkspaceProjectId(projectId ?? fallbackProjectId)
    setCreateWorkspaceError(null)
    setCreateWorkspaceOpen(true)
  }

  const handleCreateWorkspace = async (request: CodeWorkspaceCreateRequest) => {
    setCreateWorkspaceBusy(true)
    setCreateWorkspaceError(null)
    try {
      const detail = await agenticSuperAppClient.createCodeWorkspace(request)
      setActiveWorkspaceId(detail.summary.id)
      setActiveSection('workspace')
      setCreateWorkspaceOpen(false)
      await refreshWorkspaces()
      await loadWorkspace(detail.summary.id)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setCreateWorkspaceError(message)
      setError(message)
    } finally {
      setCreateWorkspaceBusy(false)
    }
  }

  // Keyboard shortcut listener
  useEffect(() => {
    const onTidy = () => void applyPreset('tidy')
    const onApplyPreset = (event: Event) => {
      const preset = (event as CustomEvent<{ preset?: string }>).detail?.preset
      if (preset === 'main_left' || preset === 'equal_columns' || preset === 'equal_rows' || preset === 'grid' || preset === 'tidy') {
        void applyPreset(preset)
      }
    }
    window.addEventListener('agentic-super-app-tidy-code-layout', onTidy)
    window.addEventListener('agentic-super-app-apply-code-layout-preset', onApplyPreset)

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const isTextEntry = target?.matches('input, textarea, [contenteditable="true"]') ?? false
      if (isTextEntry) return

      // Ctrl+Shift+T -> Tidy
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 't') {
        e.preventDefault()
        void applyPreset('tidy')
        return
      }

      // Ctrl+Shift+P -> Layout menu
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        window.dispatchEvent(new Event('agentic-super-app-open-code-layout-menu'))
        return
      }

      // Ctrl+W -> Close active pane
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'w') {
        if (state.focusedPaneId) {
          e.preventDefault()
          void requestClosePane(state.focusedPaneId)
        }
        return
      }

      // Ctrl+M -> Toggle Maximize
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        void toggleMaximize()
        return
      }

      if (e.key === 'F2' && state.focusedPaneId) {
        e.preventDefault()
        window.dispatchEvent(new Event('agentic-super-app-rename-focused-pane'))
        return
      }

      if (e.altKey && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        const focused = state.focusedPaneId
        if (!focused) return
        const current = document.querySelector<HTMLElement>(`[data-pane-id="${CSS.escape(focused)}"]`)
        if (!current) return
        const currentRect = current.getBoundingClientRect()
        const currentCenter = { x: currentRect.left + currentRect.width / 2, y: currentRect.top + currentRect.height / 2 }
        const direction = e.key === 'ArrowLeft' ? 'left' : e.key === 'ArrowRight' ? 'right' : e.key === 'ArrowUp' ? 'top' : 'bottom'
        const candidates = Array.from(document.querySelectorAll<HTMLElement>('[data-pane-id]'))
          .filter((element) => element !== current)
          .map((element) => {
            const rect = element.getBoundingClientRect()
            const center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            const inDirection = direction === 'left' ? center.x < currentCenter.x : direction === 'right' ? center.x > currentCenter.x : direction === 'top' ? center.y < currentCenter.y : center.y > currentCenter.y
            return { element, center, distance: Math.hypot(center.x - currentCenter.x, center.y - currentCenter.y), inDirection }
          })
          .filter((candidate) => candidate.inDirection)
          .sort((left, right) => left.distance - right.distance)
        const next = candidates[0]?.element.dataset.paneId
        if (next) {
          e.preventDefault()
          void focusPane(next)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('agentic-super-app-tidy-code-layout', onTidy)
      window.removeEventListener('agentic-super-app-apply-code-layout-preset', onApplyPreset)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [applyPreset, focusPane, requestClosePane, setError, state.focusedPaneId, toggleMaximize])

  return (
    <div className="code-workspace-root">
      <CodeWorkspaceRail
        controller={controller}
        projects={projects}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        activeGlobalSection={activeSection}
        onSelectWorkspace={handleSelectWorkspace}
        onAddProject={() => void handleAddProject()}
        onAddWorkspace={handleAddWorkspace}
        onSelectGlobalSection={(section) => setActiveSection(section)}
      />

      <main className="code-workspace-main">
        {activeSection === 'dashboard' && <AgenticSuperAppCodeDashboard />}
        {activeSection === 'routines' && <AgenticSuperAppCodeRoutines />}
        {activeSection === 'plugins' && <AgenticSuperAppCodePlugins />}
        {activeSection === 'skills' && <AgenticSuperAppCodeSkills />}
        {activeSection === 'workspace' && (
          <CodePaneCanvas controller={controller} onOpenFolder={() => void handleAddProject()} />
        )}
      </main>

      <CodeWorkspaceCreateDialog
        open={createWorkspaceOpen}
        projects={projects}
        activeProjectId={createWorkspaceProjectId}
        busy={createWorkspaceBusy}
        error={createWorkspaceError}
        onClose={() => { if (!createWorkspaceBusy) setCreateWorkspaceOpen(false) }}
        onSubmit={(request) => void handleCreateWorkspace(request)}
      />

    </div>
  )
}
