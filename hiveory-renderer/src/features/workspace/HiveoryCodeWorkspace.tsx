import React, { useEffect, useState, useCallback, type ReactNode } from 'react'
import {
  hiveoryClient,
  type CodePanePreset,
  type CodeProjectSummary,
  type CodeSnapshot,
  type CodeWorkspaceCreateRequest,
  type CodeWorkspaceParentRequest,
  type CodeWorkspaceSummary,
  type CodeWorkspaceUpdateRequest,
} from '../../shared/api/hiveory-client'
import { useCodeWorkspaceController } from './state/use-code-workspace-controller'
import { CodeWorkspaceRail } from './CodeWorkspaceRail'
import { CodePaneCanvas } from './CodePaneCanvas'
import { HiveoryCodeDashboard } from './HiveoryCodeDashboard'
import { HiveoryCodeRoutines } from './HiveoryCodeRoutines'
import { HiveoryCodePlugins } from './HiveoryCodePlugins'
import { HiveoryCodeSkills } from './HiveoryCodeSkills'
import { CodeParentWorkspaceDialog, CodeProjectSettingsDialog, CodeWorkspaceCreateDialog, CodeWorkspaceRenameDialog } from './CodeWorkspaceDialogs'
import { eligibleParentWorkspaces } from './code-workspace-rail-utils'
import { CodeSourcePanel } from './CodeSourcePanel'
import { CodeCoordinationPanel } from './CodeCoordinationPanel'
import './code-workspace.css'

function readSidebarCollapsed(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const preferences = JSON.parse(window.localStorage.getItem('hiveory.preferences') ?? '{}') as { sidebarCollapsed?: unknown }
    return preferences.sidebarCollapsed === true
  } catch {
    return false
  }
}

interface HiveoryCodeWorkspaceProps {
  initialWorkspaceId?: string | null
  initialSection?: 'dashboard' | 'routines' | 'plugins' | 'skills' | 'workspace'
  children?: ReactNode
}

export const HiveoryCodeWorkspace: React.FC<HiveoryCodeWorkspaceProps> = ({
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
  const [projectSettingsProjectId, setProjectSettingsProjectId] = useState<string | null>(null)
  const [renameWorkspaceId, setRenameWorkspaceId] = useState<string | null>(null)
  const [renameWorkspaceBusy, setRenameWorkspaceBusy] = useState(false)
  const [renameWorkspaceError, setRenameWorkspaceError] = useState<string | null>(null)
  const [parentWorkspaceId, setParentWorkspaceId] = useState<string | null>(null)
  const [parentWorkspaceBusy, setParentWorkspaceBusy] = useState(false)
  const [parentWorkspaceError, setParentWorkspaceError] = useState<string | null>(null)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(readSidebarCollapsed)
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false)
  const [coordinationPanelOpen, setCoordinationPanelOpen] = useState(false)

  const controller = useCodeWorkspaceController(activeWorkspaceId)
  const { loadWorkspace, applyPreset, requestClosePane, toggleMaximize, focusPane, setError, state } = controller
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null
  const renameWorkspace = workspaces.find((workspace) => workspace.id === renameWorkspaceId) ?? null
  const parentWorkspace = workspaces.find((workspace) => workspace.id === parentWorkspaceId) ?? null
  const parentWorkspaceCandidates = parentWorkspace ? eligibleParentWorkspaces(parentWorkspace, workspaces) : []

  const refreshWorkspaces = useCallback(async (): Promise<CodeSnapshot | null> => {
    try {
      const snapshot = await hiveoryClient.codeSnapshot()
      setProjects(snapshot.projects)
      setWorkspaces(snapshot.workspaces)
      const activeWorkspaceStillAvailable = Boolean(activeWorkspaceId && snapshot.workspaces.some((workspace) => workspace.id === activeWorkspaceId && workspace.available))
      if (!activeWorkspaceStillAvailable) {
        const availableWorkspace = snapshot.workspaces.find((workspace) => workspace.available)
        const nextId = snapshot.active_workspace_id && snapshot.workspaces.some((workspace) => workspace.id === snapshot.active_workspace_id && workspace.available)
          ? snapshot.active_workspace_id
          : availableWorkspace?.id ?? null
        setActiveWorkspaceId(nextId)
        if (nextId) void loadWorkspace(nextId)
      }
      return snapshot
    } catch {
      // ignore snapshot error
      return null
    }
  }, [activeWorkspaceId, loadWorkspace])

  useEffect(() => {
    void refreshWorkspaces()
  }, [refreshWorkspaces])

  useEffect(() => {
    const handleSidebarToggle = (event: Event) => {
      const requested = (event as CustomEvent<{ collapsed?: unknown }>).detail?.collapsed
      setSidebarCollapsed(typeof requested === 'boolean' ? requested : (current) => !current)
    }
    window.addEventListener('hiveory-sidebar-toggle', handleSidebarToggle)
    return () => window.removeEventListener('hiveory-sidebar-toggle', handleSidebarToggle)
  }, [])

  const handleSelectWorkspace = (wsId: string) => {
    if (wsId === activeWorkspaceId) return
    setActiveWorkspaceId(wsId)
    setActiveSection('workspace')
  }

  const handleAddProject = async () => {
    const path = await hiveoryClient.chooseWorkspacePath()
    if (!path) return
    try {
      const detail = await hiveoryClient.addCodeProject(path)
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
      const detail = await hiveoryClient.createCodeWorkspace(request)
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

  const handleOpenRenameWorkspace = (workspace: CodeWorkspaceSummary) => {
    setRenameWorkspaceError(null)
    setRenameWorkspaceId(workspace.id)
  }

  const handleUpdateWorkspace = async (request: CodeWorkspaceUpdateRequest) => {
    setRenameWorkspaceBusy(true)
    setRenameWorkspaceError(null)
    try {
      await hiveoryClient.updateCodeWorkspace(request)
      setRenameWorkspaceId(null)
      await refreshWorkspaces()
      if (activeWorkspaceId === request.workspace_id) await loadWorkspace(request.workspace_id)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setRenameWorkspaceError(message)
      setError(message)
    } finally {
      setRenameWorkspaceBusy(false)
    }
  }

  const handleOpenParentWorkspace = (workspace: CodeWorkspaceSummary) => {
    setParentWorkspaceError(null)
    setParentWorkspaceId(workspace.id)
  }

  const handleSetParentWorkspace = async (request: CodeWorkspaceParentRequest) => {
    setParentWorkspaceBusy(true)
    setParentWorkspaceError(null)
    try {
      await hiveoryClient.setCodeWorkspaceParent(request)
      setParentWorkspaceId(null)
      await refreshWorkspaces()
      if (activeWorkspaceId === request.workspace_id) await loadWorkspace(request.workspace_id)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setParentWorkspaceError(message)
      setError(message)
    } finally {
      setParentWorkspaceBusy(false)
    }
  }

  const handleRemoveWorkspace = async (workspaceId: string) => {
    const workspace = workspaces.find((item) => item.id === workspaceId)
    if (!workspace) return
    const message = workspace.managed_by_app
      ? `Delete "${workspace.display_name}"? Running panes will be stopped and this app-managed worktree will be permanently removed. Uncommitted changes in it will be lost.`
      : `Remove "${workspace.display_name}" from this app? Its folder and files will be kept.`
    if (!window.confirm(message)) return
    try {
      await hiveoryClient.removeCodeWorkspace({ workspace_id: workspace.id, force: true })
      await refreshWorkspaces()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleRemoveProject = async (projectId: string) => {
    const project = projects.find((item) => item.id === projectId)
    if (!project) return
    const message = `Remove "${project.display_name}" from this app? Running panes will be stopped, app-managed secondary worktrees will be deleted, and the primary project folder will be preserved.`
    if (!window.confirm(message)) return
    try {
      await hiveoryClient.removeCodeProject({ project_id: project.id, force: true })
      await refreshWorkspaces()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const handleToggleSourcePanel = (open?: boolean) => {
    setActiveSection('workspace')
    setCoordinationPanelOpen(false)
    setSourcePanelOpen((current) => typeof open === 'boolean' ? open : !current)
  }

  const handleToggleCoordinationPanel = (open?: boolean) => {
    setActiveSection('workspace')
    setSourcePanelOpen(false)
    setCoordinationPanelOpen((current) => typeof open === 'boolean' ? open : !current)
  }

  // Keyboard shortcut listener
  useEffect(() => {
    const onTidy = () => void applyPreset('tidy')
    const onApplyPreset = (event: Event) => {
      const preset = (event as CustomEvent<{ preset?: CodePanePreset }>).detail?.preset
      if (preset) {
        void applyPreset(preset)
      }
    }
    window.addEventListener('hiveory-tidy-code-layout', onTidy)
    window.addEventListener('hiveory-apply-code-layout-preset', onApplyPreset)

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
        window.dispatchEvent(new Event('hiveory-open-code-layout-menu'))
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
        window.dispatchEvent(new Event('hiveory-rename-focused-pane'))
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
      window.removeEventListener('hiveory-tidy-code-layout', onTidy)
      window.removeEventListener('hiveory-apply-code-layout-preset', onApplyPreset)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [applyPreset, focusPane, requestClosePane, setError, state.focusedPaneId, toggleMaximize])

  return (
    <div className={`code-workspace-root ${sidebarCollapsed ? 'is-sidebar-collapsed' : ''}`}>
      <CodeWorkspaceRail
        controller={controller}
        projects={projects}
        workspaces={workspaces}
        activeWorkspaceId={activeWorkspaceId}
        activeGlobalSection={activeSection}
        onSelectWorkspace={handleSelectWorkspace}
        onAddProject={() => void handleAddProject()}
        onAddWorkspace={handleAddWorkspace}
        onOpenProjectSettings={setProjectSettingsProjectId}
        onRenameWorkspace={handleOpenRenameWorkspace}
        onOpenParentWorkspaceDialog={handleOpenParentWorkspace}
        onRemoveProject={(projectId) => void handleRemoveProject(projectId)}
        onRemoveWorkspace={(workspaceId) => void handleRemoveWorkspace(workspaceId)}
        onSelectGlobalSection={(section) => setActiveSection(section)}
        sourcePanelOpen={sourcePanelOpen}
        coordinationPanelOpen={coordinationPanelOpen}
        onToggleSourcePanel={handleToggleSourcePanel}
        onToggleCoordinationPanel={handleToggleCoordinationPanel}
      />

      <main className="code-workspace-main">
        {activeSection === 'dashboard' && <HiveoryCodeDashboard />}
        {activeSection === 'routines' && <HiveoryCodeRoutines />}
        {activeSection === 'plugins' && <HiveoryCodePlugins />}
        {activeSection === 'skills' && <HiveoryCodeSkills />}
        {activeSection === 'workspace' && (
          <div className="code-workspace-workspace-view">
            <div className={`code-workspace-canvas-shell ${sourcePanelOpen && activeWorkspace ? 'has-source-panel' : ''} ${coordinationPanelOpen && activeWorkspace ? 'has-coordination-panel' : ''}`}>
              <CodePaneCanvas controller={controller} onOpenFolder={() => void handleAddProject()} />
              {sourcePanelOpen && activeWorkspace && <CodeSourcePanel workspace={activeWorkspace} onClose={() => setSourcePanelOpen(false)} onWorkspaceChanged={refreshWorkspaces} />}
              {coordinationPanelOpen && activeWorkspace && <CodeCoordinationPanel workspace={activeWorkspace} onClose={() => setCoordinationPanelOpen(false)} />}
            </div>
          </div>
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

      <CodeProjectSettingsDialog
        open={projectSettingsProjectId !== null}
        project={projects.find((project) => project.id === projectSettingsProjectId) ?? null}
        onClose={() => setProjectSettingsProjectId(null)}
      />

      <CodeWorkspaceRenameDialog
        open={renameWorkspaceId !== null}
        workspace={renameWorkspace}
        busy={renameWorkspaceBusy}
        error={renameWorkspaceError}
        onClose={() => { if (!renameWorkspaceBusy) setRenameWorkspaceId(null) }}
        onSubmit={(request) => void handleUpdateWorkspace(request)}
      />

      <CodeParentWorkspaceDialog
        open={parentWorkspaceId !== null}
        workspace={parentWorkspace}
        candidates={parentWorkspaceCandidates}
        busy={parentWorkspaceBusy}
        error={parentWorkspaceError}
        onClose={() => { if (!parentWorkspaceBusy) setParentWorkspaceId(null) }}
        onSubmit={(request) => void handleSetParentWorkspace(request)}
      />

    </div>
  )
}
