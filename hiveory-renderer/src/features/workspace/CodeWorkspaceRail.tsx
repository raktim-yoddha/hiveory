import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BriefcaseBusiness,
  Bell,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Copy,
  Clock3,
  ExternalLink,
  FileText,
  Folder,
  FolderOpen,
  FolderTree,
  GitBranch,
  LayoutDashboard,
  MoreVertical,
  Moon,
  Package,
  Pencil,
  Pin,
  Plus,
  Puzzle,
  Settings,
  Settings2,
  Sparkles,
  SquareTerminal,
  Trash2,
} from 'lucide-react'
import type {
  CodePaneNode,
  CodeProjectSummary,
  CodeWorkspaceSummary,
} from '../../shared/api/hiveory-client'
import { hiveoryClient, type CodeWorkspaceOpenTarget } from '../../shared/api/hiveory-client'
import type { CodeWorkspaceController } from './state/use-code-workspace-controller'
import { CliBrandIcon } from './CliIcons'
import { CodeProjectGroupDialog } from './CodeWorkspaceDialogs'
import { eligibleParentWorkspaces, shouldShowProjectWorkspaceRows } from './code-workspace-rail-utils'

interface CodeWorkspaceRailProps {
  controller: CodeWorkspaceController
  projects: CodeProjectSummary[]
  workspaces: CodeWorkspaceSummary[]
  activeWorkspaceId: string | null
  activeGlobalSection: 'dashboard' | 'routines' | 'plugins' | 'skills' | 'workspace'
  onSelectWorkspace: (workspaceId: string) => void
  onAddProject: () => void
  onAddWorkspace: (projectId?: string) => void
  onOpenProjectSettings?: (projectId: string) => void
  onRenameWorkspace: (workspace: CodeWorkspaceSummary) => void
  onOpenParentWorkspaceDialog: (workspace: CodeWorkspaceSummary) => void
  onRemoveProject: (projectId: string) => void
  onRemoveWorkspace: (workspaceId: string) => void
  onSelectGlobalSection?: (section: 'dashboard' | 'routines' | 'plugins' | 'skills' | 'workspace') => void
  sourcePanelOpen: boolean
  coordinationPanelOpen: boolean
  onToggleSourcePanel: (open?: boolean) => void
  onToggleCoordinationPanel: (open?: boolean) => void
}

type ProjectIconId = 'folder' | 'git' | 'briefcase' | 'package'
type ContextMenuState = { kind: 'project' | 'workspace'; id: string } | null
type WorkspaceRailFlags = { pinned?: boolean; unread?: boolean; sleeping?: boolean }
type RailPreferences = {
  projectIcons?: Record<string, ProjectIconId>
  projectGroups?: Record<string, string>
  workspaceFlags?: Record<string, WorkspaceRailFlags>
}

function readRailPreferences(): Required<RailPreferences> {
  if (typeof window === 'undefined') return { projectIcons: {}, projectGroups: {}, workspaceFlags: {} }
  try {
    const parsed = JSON.parse(window.localStorage.getItem('hiveory.code.rail.preferences') ?? '{}') as RailPreferences
    return {
      projectIcons: parsed.projectIcons ?? {},
      projectGroups: parsed.projectGroups ?? {},
      workspaceFlags: parsed.workspaceFlags ?? {},
    }
  } catch {
    return { projectIcons: {}, projectGroups: {}, workspaceFlags: {} }
  }
}

const PROJECT_ICON_OPTIONS: { id: ProjectIconId; label: string }[] = [
  { id: 'folder', label: 'Folder' },
  { id: 'git', label: 'Git repository' },
  { id: 'briefcase', label: 'Workspace' },
  { id: 'package', label: 'Package' },
]

function renderProjectIcon(icon: ProjectIconId) {
  if (icon === 'git') return <GitBranch size={14} aria-hidden="true" />
  if (icon === 'briefcase') return <BriefcaseBusiness size={14} aria-hidden="true" />
  if (icon === 'package') return <Package size={14} aria-hidden="true" />
  return <Folder size={14} aria-hidden="true" />
}

function renderPaneRailIcon(node: CodePaneNode) {
  switch (node.kind) {
    case 'coding_agent':
      return <CliBrandIcon identifier={node.title} size={13} />
    case 'preview':
      return <FolderOpen size={13} style={{ color: '#aeb7c2' }} aria-hidden="true" />
    case 'markdown':
      return <FileText size={13} style={{ color: '#9ca3af' }} aria-hidden="true" />
    case 'terminal':
      return <SquareTerminal size={13} style={{ color: '#9ca3af' }} aria-hidden="true" />
    default:
      return <Sparkles size={13} style={{ color: '#9ca3af' }} aria-hidden="true" />
  }
}

export const CodeWorkspaceRail: React.FC<CodeWorkspaceRailProps> = ({
  controller,
  projects,
  workspaces,
  activeWorkspaceId,
  activeGlobalSection,
  onSelectWorkspace,
  onAddProject,
  onAddWorkspace,
  onOpenProjectSettings,
  onRenameWorkspace,
  onOpenParentWorkspaceDialog,
  onRemoveProject,
  onRemoveWorkspace,
  onSelectGlobalSection,
  sourcePanelOpen,
  coordinationPanelOpen,
  onToggleSourcePanel,
  onToggleCoordinationPanel,
}) => {
  const DEFAULT_RAIL_WIDTH = 228
  const MIN_RAIL_WIDTH = 180
  const MAX_RAIL_WIDTH = 480

  const [railWidth, setRailWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return DEFAULT_RAIL_WIDTH
    const stored = localStorage.getItem('hiveory_rail_width')
    if (stored) {
      const parsed = Number(stored)
      if (!Number.isNaN(parsed) && parsed >= MIN_RAIL_WIDTH && parsed <= MAX_RAIL_WIDTH) {
        return parsed
      }
    }
    return DEFAULT_RAIL_WIDTH
  })

  const [isResizing, setIsResizing] = useState(false)
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null)

  useEffect(() => {
    document.documentElement.style.setProperty('--code-rail-width', `${railWidth}px`)
    try {
      localStorage.setItem('hiveory_rail_width', String(railWidth))
    } catch {
      // Browser preview storage is optional.
    }
  }, [railWidth])

  const handleResizeStart = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
    resizeStartRef.current = { startX: e.clientX, startWidth: railWidth }

    const handlePointerMove = (moveEvent: PointerEvent) => {
      if (!resizeStartRef.current) return
      const deltaX = moveEvent.clientX - resizeStartRef.current.startX
      const maxAllowed = Math.min(MAX_RAIL_WIDTH, window.innerWidth * 0.5)
      const newWidth = Math.min(
        maxAllowed,
        Math.max(MIN_RAIL_WIDTH, Math.round(resizeStartRef.current.startWidth + deltaX))
      )
      setRailWidth(newWidth)
    }

    const handlePointerUp = () => {
      setIsResizing(false)
      resizeStartRef.current = null
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
  }, [railWidth])

  const handleResetWidth = useCallback(() => {
    setRailWidth(DEFAULT_RAIL_WIDTH)
  }, [])

  const { state, focusPane } = controller
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false)
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set())
  const [openContextMenu, setOpenContextMenu] = useState<ContextMenuState>(null)
  const [contextMenuPosition, setContextMenuPosition] = useState<{ top: number; left: number } | null>(null)
  const [openProjectIconMenuId, setOpenProjectIconMenuId] = useState<string | null>(null)
  const [openWorkspaceSubmenuId, setOpenWorkspaceSubmenuId] = useState<string | null>(null)
  const [projectGroupDialogId, setProjectGroupDialogId] = useState<string | null>(null)
  const [projectIcons, setProjectIcons] = useState<Record<string, ProjectIconId>>(() => readRailPreferences().projectIcons)
  const [projectGroups, setProjectGroups] = useState<Record<string, string>>(() => readRailPreferences().projectGroups)
  const [workspaceFlags, setWorkspaceFlags] = useState<Record<string, WorkspaceRailFlags>>(() => readRailPreferences().workspaceFlags)
  const [actionNotice, setActionNotice] = useState<string | null>(null)
  const actionNoticeTimerRef = useRef<number | null>(null)
  const contextMenuRef = useRef<HTMLDivElement | null>(null)
  const addMenuRef = useRef<HTMLDivElement | null>(null)
  const leaves = state.layout?.nodes.filter((node) => node.children.length === 0) ?? []
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null

  useEffect(() => {
    try {
      localStorage.setItem('hiveory.code.rail.preferences', JSON.stringify({ projectIcons, projectGroups, workspaceFlags }))
    } catch {
      // Browser preview storage is optional.
    }
  }, [projectGroups, projectIcons, workspaceFlags])

  useEffect(() => () => {
    if (actionNoticeTimerRef.current !== null) window.clearTimeout(actionNoticeTimerRef.current)
  }, [])
  const projectRows = useMemo(() => {
    if (projects.length > 0) return projects
    const fallback = new Map<string, CodeProjectSummary>()
    for (const workspace of workspaces) {
      if (fallback.has(workspace.project_id)) continue
      fallback.set(workspace.project_id, {
        id: workspace.project_id,
        host_id: workspace.host_id,
        display_name: workspace.repository_name ?? workspace.display_name,
        root_path: workspace.root_path,
        repository_name: workspace.repository_name,
        kind: workspace.is_git_repository ? 'git' : 'folder',
        primary_workspace_id: workspace.id,
        current_branch: workspace.branch,
        workspace_count: 1,
        available: workspace.available,
        unavailable_reason: workspace.unavailable_reason,
        updated_at_unix_ms: workspace.updated_at_unix_ms,
      })
    }
    return [...fallback.values()]
  }, [projects, workspaces])

  useEffect(() => {
    if (!openContextMenu && !isAddMenuOpen) return

    const handleOutsidePointer = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (
        openContextMenu &&
        contextMenuRef.current &&
        !contextMenuRef.current.contains(target) &&
        !((event.target as HTMLElement).closest?.('.code-rail-workspace-menu-trigger') ||
          (event.target as HTMLElement).closest?.('.code-rail-project-menu-trigger'))
      ) {
        setOpenContextMenu(null)
        setContextMenuPosition(null)
        setOpenProjectIconMenuId(null)
        setOpenWorkspaceSubmenuId(null)
      }
      if (
        isAddMenuOpen &&
        addMenuRef.current &&
        !addMenuRef.current.contains(target) &&
        !((event.target as HTMLElement).closest?.('.code-rail-add-btn'))
      ) {
        setIsAddMenuOpen(false)
      }
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenContextMenu(null)
        setContextMenuPosition(null)
        setOpenProjectIconMenuId(null)
        setOpenWorkspaceSubmenuId(null)
        setIsAddMenuOpen(false)
      }
    }
    const handleScroll = () => {
      if (openContextMenu) {
        setOpenContextMenu(null)
        setContextMenuPosition(null)
        setOpenProjectIconMenuId(null)
        setOpenWorkspaceSubmenuId(null)
      }
    }

    document.addEventListener('pointerdown', handleOutsidePointer)
    document.addEventListener('keydown', handleEscape)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePointer)
      document.removeEventListener('keydown', handleEscape)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [openContextMenu, isAddMenuOpen])

  const navItems: { id: 'dashboard' | 'routines' | 'plugins' | 'skills'; label: string; badge?: string; icon: React.ReactNode }[] = [
    { id: 'dashboard', label: 'Dashboard', badge: '1', icon: <LayoutDashboard size={15} aria-hidden="true" /> },
    { id: 'routines', label: 'Routines', icon: <Clock3 size={15} aria-hidden="true" /> },
    { id: 'plugins', label: 'Plugins', icon: <Puzzle size={15} aria-hidden="true" /> },
    { id: 'skills', label: 'Skills', icon: <Sparkles size={15} aria-hidden="true" /> },
  ]

  const toggleProject = (projectId: string) => {
    setCollapsedProjects((current) => {
      const next = new Set(current)
      if (next.has(projectId)) next.delete(projectId)
      else next.add(projectId)
      return next
    })
  }

  const activateWorkspace = (workspaceId: string) => {
    setOpenContextMenu(null)
    setContextMenuPosition(null)
    setOpenProjectIconMenuId(null)
    setOpenWorkspaceSubmenuId(null)
    onSelectWorkspace(workspaceId)
    onSelectGlobalSection?.('workspace')
  }

  const openWorkspacePanel = (workspaceId: string, panel: 'source' | 'coordination') => {
    setOpenContextMenu(null)
    setContextMenuPosition(null)
    setOpenProjectIconMenuId(null)
    setOpenWorkspaceSubmenuId(null)
    onSelectWorkspace(workspaceId)
    onSelectGlobalSection?.('workspace')
    if (panel === 'source') {
      const alreadyOpenForWorkspace = sourcePanelOpen && activeWorkspaceId === workspaceId
      onToggleSourcePanel(!alreadyOpenForWorkspace)
    } else {
      const alreadyOpenForWorkspace = coordinationPanelOpen && activeWorkspaceId === workspaceId
      onToggleCoordinationPanel(!alreadyOpenForWorkspace)
    }
  }

  const openContextMenuAt = (
    event: React.MouseEvent<HTMLButtonElement | HTMLElement>,
    kind: 'project' | 'workspace',
    id: string,
    menuHeight: number,
    atPointer = false,
  ) => {
    event.stopPropagation()
    if (openContextMenu?.kind === kind && openContextMenu.id === id) {
      setOpenContextMenu(null)
      setContextMenuPosition(null)
      setOpenProjectIconMenuId(null)
      setOpenWorkspaceSubmenuId(null)
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    const menuWidth = kind === 'project' ? 240 : 256
    const left = atPointer
      ? Math.max(8, Math.min(event.clientX + 4, window.innerWidth - menuWidth - 12))
      : (rect.right + 6 + menuWidth <= window.innerWidth
        ? rect.right + 6
        : Math.max(8, rect.left - menuWidth - 6))
    let top = atPointer ? event.clientY : rect.top
    const maxTop = window.innerHeight - menuHeight - 12
    if (top > maxTop) {
      top = Math.max(12, maxTop)
    }
    setContextMenuPosition({ top, left })
    setOpenProjectIconMenuId(null)
    setOpenWorkspaceSubmenuId(null)
    setOpenContextMenu({ kind, id })
  }

  const closeContextMenu = () => {
    setOpenContextMenu(null)
    setContextMenuPosition(null)
    setOpenProjectIconMenuId(null)
    setOpenWorkspaceSubmenuId(null)
  }

  const announce = (message: string) => {
    if (actionNoticeTimerRef.current !== null) window.clearTimeout(actionNoticeTimerRef.current)
    setActionNotice(message)
    actionNoticeTimerRef.current = window.setTimeout(() => {
      setActionNotice(null)
      actionNoticeTimerRef.current = null
    }, 2600)
  }

  const toggleWorkspaceFlag = (workspaceId: string, flag: keyof WorkspaceRailFlags) => {
    const nextValue = !workspaceFlags[workspaceId]?.[flag]
    setWorkspaceFlags((current) => ({
      ...current,
      [workspaceId]: {
        ...current[workspaceId],
        [flag]: !current[workspaceId]?.[flag],
      },
    }))
    announce(nextValue ? `${flag === 'pinned' ? 'Workspace pinned' : flag === 'unread' ? 'Workspace marked unread' : 'Workspace put to sleep'}` : `${flag === 'pinned' ? 'Workspace unpinned' : flag === 'unread' ? 'Workspace marked read' : 'Workspace awakened'}`)
    closeContextMenu()
  }

  const toggleProjectGroup = (projectId: string) => {
    closeContextMenu()
    setProjectGroupDialogId(projectId)
  }

  const saveProjectGroup = (projectId: string, groupName: string | null) => {
    setProjectGroups((current) => {
      const next = { ...current }
      if (groupName?.trim()) next[projectId] = groupName.trim()
      else delete next[projectId]
      return next
    })
    setProjectGroupDialogId(null)
    announce(groupName?.trim() ? 'Project group saved' : 'Project removed from its group')
  }

  const setProjectIcon = (projectId: string, icon: ProjectIconId) => {
    setProjectIcons((current) => ({ ...current, [projectId]: icon }))
    announce('Project icon updated')
    closeContextMenu()
  }

  const copyWorkspacePath = async (workspace: CodeWorkspaceSummary) => {
    let copied = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(workspace.root_path)
        copied = true
      }
    } catch {
      copied = false
    }
    if (!copied) {
      const textarea = document.createElement('textarea')
      textarea.value = workspace.root_path
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      try {
        copied = document.execCommand('copy')
      } catch {
        copied = false
      } finally {
        textarea.remove()
      }
    }
    announce(copied ? 'Workspace path copied' : 'Clipboard access was blocked')
    closeContextMenu()
  }

  const openWorkspaceIn = async (workspace: CodeWorkspaceSummary, target: CodeWorkspaceOpenTarget) => {
    try {
      await hiveoryClient.openCodeWorkspaceIn({ workspace_id: workspace.id, target })
      announce(target === 'file_manager' ? 'Opened in File Explorer' : 'Opened in external terminal')
    } catch (err: unknown) {
      controller.setError(err instanceof Error ? err.message : String(err))
    } finally {
      closeContextMenu()
    }
  }

  const sleepWorkspace = async (workspace: CodeWorkspaceSummary) => {
    const isSleeping = workspaceFlags[workspace.id]?.sleeping === true
    if (isSleeping) {
      setWorkspaceFlags((current) => ({ ...current, [workspace.id]: { ...current[workspace.id], sleeping: false } }))
      announce('Workspace awake; no panes were restarted')
      closeContextMenu()
      return
    }
    const completed = await controller.sleepWorkspace(workspace.id)
    if (!completed) return
    setWorkspaceFlags((current) => ({ ...current, [workspace.id]: { ...current[workspace.id], sleeping: true } }))
    announce('Workspace slept; active terminals were stopped')
    closeContextMenu()
  }

  const renderWorkspaceActions = (workspace: CodeWorkspaceSummary) => {
    const isOpen = openContextMenu?.kind === 'workspace' && openContextMenu.id === workspace.id
    const isPrimary = workspace.workspace_kind === 'primary'
    return (
      <div className="code-rail-workspace-actions">
        <button
          type="button"
          className={`code-rail-workspace-menu-trigger ${isOpen ? 'is-open' : ''}`}
          onClick={(event) => openContextMenuAt(event, 'workspace', workspace.id, isPrimary ? 470 : 520)}
          aria-label={`Workspace actions for ${workspace.display_name}`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          title={`Workspace actions for ${workspace.display_name}`}
        >
          <MoreVertical size={14} aria-hidden="true" />
        </button>
      </div>
    )
  }

  const renderProjectActions = (project: CodeProjectSummary) => {
    const isOpen = openContextMenu?.kind === 'project' && openContextMenu.id === project.id
    return (
      <div className="code-rail-project-menu-actions">
        <button
          type="button"
          className={`code-rail-project-menu-trigger ${isOpen ? 'is-open' : ''}`}
          onClick={(event) => openContextMenuAt(event, 'project', project.id, 240)}
          aria-label={`Project actions for ${project.display_name}`}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          title={`Project actions for ${project.display_name}`}
        >
          <MoreVertical size={14} aria-hidden="true" />
        </button>
      </div>
    )
  }

  const renderActiveContextMenu = () => {
    if (!openContextMenu || !contextMenuPosition) return null

    if (openContextMenu.kind === 'workspace') {
      const workspace = workspaces.find((w) => w.id === openContextMenu.id)
      if (!workspace) return null
      const isPrimary = workspace.workspace_kind === 'primary'
      const flags = workspaceFlags[workspace.id] ?? {}
      const cleanPath = workspace.root_path.replace(/^\\\\\?\\/, '')
      const parentCandidates = eligibleParentWorkspaces(workspace, workspaces)
      const parentActionDisabled = isPrimary || (parentCandidates.length === 0 && !workspace.parent_workspace_id)

      return (
        <div
          ref={contextMenuRef}
          className="code-rail-context-menu code-rail-workspace-menu"
          role="menu"
          aria-label={`Actions for ${workspace.display_name}`}
          style={{ top: contextMenuPosition.top, left: contextMenuPosition.left }}
        >
          <div className="code-rail-context-menu-heading">
            <span className="code-rail-context-menu-tag">{isPrimary ? 'Primary Workspace' : 'Workspace'}</span>
            <strong className="code-rail-context-menu-title">{workspace.display_name}</strong>
            <small className="code-rail-context-menu-path" title={workspace.root_path}>
              {workspace.trust === 'trusted' ? 'Trusted' : 'Read only'} · {cleanPath}
            </small>
          </div>
          <button type="button" role="menuitem" onClick={() => activateWorkspace(workspace.id)}>
            <FolderOpen size={14} aria-hidden="true" />
            <span>Open canvas</span>
          </button>
          <button type="button" role="menuitem" onClick={() => openWorkspacePanel(workspace.id, 'source')}>
            <GitBranch size={14} aria-hidden="true" />
            <span>{sourcePanelOpen && activeWorkspaceId === workspace.id ? 'Hide source panel' : 'Open source panel'}</span>
          </button>
          <button type="button" role="menuitem" onClick={() => openWorkspacePanel(workspace.id, 'coordination')}>
            <Settings2 size={14} aria-hidden="true" />
            <span>{coordinationPanelOpen && activeWorkspaceId === workspace.id ? 'Hide coordination panel' : 'Open coordination panel'}</span>
          </button>
          <div className="code-rail-context-menu-separator" />
          <button type="button" role="menuitem" onClick={() => { closeContextMenu(); onRenameWorkspace(workspace) }}>
            <Pencil size={14} aria-hidden="true" />
            <span>Update</span>
          </button>
          <div className="code-rail-context-menu-separator" />
          <button type="button" role="menuitem" onClick={() => setOpenWorkspaceSubmenuId((current) => current === workspace.id ? null : workspace.id)} aria-haspopup="menu" aria-expanded={openWorkspaceSubmenuId === workspace.id}>
            <ExternalLink size={14} aria-hidden="true" />
            <span>Open in</span>
            <ChevronRight size={13} className="code-rail-menu-chevron" aria-hidden="true" />
          </button>
          {openWorkspaceSubmenuId === workspace.id && (
            <div className="code-rail-context-submenu" role="group" aria-label="Open workspace in">
              <button type="button" role="menuitem" onClick={() => void openWorkspaceIn(workspace, 'file_manager')}>
                <FolderOpen size={13} aria-hidden="true" />
                <span>File Explorer</span>
              </button>
              <button type="button" role="menuitem" onClick={() => void openWorkspaceIn(workspace, 'terminal')}>
                <SquareTerminal size={13} aria-hidden="true" />
                <span>Terminal</span>
              </button>
            </div>
          )}
          <button type="button" role="menuitem" onClick={() => void copyWorkspacePath(workspace)}>
            <Copy size={14} aria-hidden="true" />
            <span>Copy Path</span>
          </button>
          <div className="code-rail-context-menu-separator" />
          <button type="button" role="menuitem" onClick={() => toggleWorkspaceFlag(workspace.id, 'pinned')}>
            <Pin size={14} aria-hidden="true" />
            <span>{flags.pinned ? 'Unpin' : 'Pin'}</span>
          </button>
          <button type="button" role="menuitem" onClick={() => toggleWorkspaceFlag(workspace.id, 'unread')}>
            <Bell size={14} aria-hidden="true" />
            <span>{flags.unread ? 'Mark read' : 'Mark unread'}</span>
          </button>
          <div className="code-rail-context-menu-separator" />
          <button type="button" role="menuitem" onClick={() => toggleProjectGroup(workspace.project_id)}>
            <FolderTree size={14} aria-hidden="true" />
            <span>{projectGroups[workspace.project_id] ? 'Edit project group' : 'New group from project'}</span>
          </button>
          <div className="code-rail-context-menu-separator" />
          <button type="button" role="menuitem" className={parentActionDisabled ? 'is-disabled' : ''} disabled={parentActionDisabled} onClick={() => { closeContextMenu(); onOpenParentWorkspaceDialog(workspace) }} title={isPrimary ? 'The primary workspace is the project root' : parentActionDisabled ? 'No eligible parent workspace is available' : 'Set or clear the parent workspace'}>
            <GitBranch size={14} aria-hidden="true" />
            <span>{workspace.parent_workspace_id ? 'Change Parent Worktree…' : 'Set Parent Worktree…'}</span>
          </button>
          <button type="button" role="menuitem" onClick={() => void sleepWorkspace(workspace)}>
            <Moon size={14} aria-hidden="true" />
            <span>{flags.sleeping ? 'Wake' : 'Sleep'}</span>
          </button>
          <div className="code-rail-context-menu-separator" />
          {isPrimary ? (
            <button type="button" role="menuitem" className="is-danger" onClick={() => { closeContextMenu(); onRemoveProject(workspace.project_id) }}>
              <Trash2 size={14} aria-hidden="true" />
              <span>Remove Project</span>
            </button>
          ) : (
            <button type="button" role="menuitem" className="is-danger" onClick={() => { closeContextMenu(); onRemoveWorkspace(workspace.id) }}>
              <Trash2 size={14} aria-hidden="true" />
              <span>{workspace.managed_by_app ? 'Delete Workspace' : 'Remove Workspace'}</span>
            </button>
          )}
        </div>
      )
    }

    if (openContextMenu.kind === 'project') {
      const project = projectRows.find((p) => p.id === openContextMenu.id)
      if (!project) return null
      const iconMenuOpen = openProjectIconMenuId === project.id

      return (
        <div
          ref={contextMenuRef}
          className="code-rail-context-menu code-rail-project-menu"
          role="menu"
          aria-label={`Actions for ${project.display_name}`}
          style={{ top: contextMenuPosition.top, left: contextMenuPosition.left }}
        >
          <button type="button" role="menuitem" onClick={() => { closeContextMenu(); onOpenProjectSettings?.(project.id) }}>
            <Settings2 size={14} aria-hidden="true" />
            <span>Project Settings</span>
          </button>
          <button type="button" role="menuitem" onClick={() => setOpenProjectIconMenuId((current) => current === project.id ? null : project.id)}>
            <FolderOpen size={14} aria-hidden="true" />
            <span>Change Project Icon</span>
            <ChevronRight size={13} className="code-rail-menu-chevron" aria-hidden="true" />
          </button>
          {iconMenuOpen && (
            <div className="code-rail-project-icon-picker" role="group" aria-label="Project icon choices">
              {PROJECT_ICON_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option.id}
                  className={projectIcons[project.id] === option.id ? 'is-selected' : ''}
                  onClick={() => setProjectIcon(project.id, option.id)}
                  title={option.label}
                  aria-label={option.label}
                >
                  {renderProjectIcon(option.id)}
                </button>
              ))}
            </div>
          )}
          <button type="button" role="menuitem" onClick={() => toggleProjectGroup(project.id)}>
            <FolderTree size={14} aria-hidden="true" />
            <span>{projectGroups[project.id] ? 'Edit project group' : 'New group from project'}</span>
          </button>
          <div className="code-rail-context-menu-separator" />
          <button type="button" role="menuitem" className="is-danger" onClick={() => { closeContextMenu(); onRemoveProject(project.id) }}>
            <Trash2 size={14} aria-hidden="true" />
            <span>Remove Project</span>
          </button>
        </div>
      )
    }

    return null
  }

  const renderPaneTree = (workspaceId: string) => {
    if (workspaceId !== activeWorkspaceId || activeGlobalSection !== 'workspace') return null

    return (
      <div className="code-rail-pane-tree">
        {leaves.map((leaf) => {
          const isFocused = leaf.pane_id === state.focusedPaneId
          return (
            <button
              type="button"
              key={leaf.pane_id}
              className={`code-rail-pane-row ${isFocused ? 'is-focused' : ''}`}
              onClick={() => {
                onSelectGlobalSection?.('workspace')
                void focusPane(leaf.pane_id)
              }}
            >
              {renderPaneRailIcon(leaf)}
              <span>{leaf.title || (leaf.kind === 'empty' ? 'New pane' : leaf.kind.replace('_', ' '))}</span>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <aside
      className={`code-workspace-rail ${isResizing ? 'is-resizing' : ''}`}
      style={{ width: `${railWidth}px`, minWidth: `${railWidth}px`, maxWidth: `${railWidth}px` }}
      aria-label="Code workspace"
    >
      <nav className="code-rail-global-nav" aria-label="Application sections">
        {navItems.map(({ id, label, badge, icon }) => (
          <button
            type="button"
            key={id}
            className={`code-rail-nav-item ${activeGlobalSection === id ? 'is-selected' : ''}`}
            onClick={() => onSelectGlobalSection?.(id)}
          >
            <span className="code-rail-nav-left">{icon}<span>{label}</span></span>
            {badge && <span className="code-rail-badge-count">{badge}</span>}
          </button>
        ))}
      </nav>

      <div className="code-rail-section-header">
        <span>Workspaces</span>
        <div className="code-rail-add-wrapper">
          <button
            type="button"
            className="code-rail-add-btn"
            onClick={() => setIsAddMenuOpen((current) => !current)}
            aria-label="Add project or workspace"
            aria-expanded={isAddMenuOpen}
            title="Add project or workspace"
          >
            <Plus size={15} aria-hidden="true" />
          </button>
        </div>
        {isAddMenuOpen && (
          <div ref={addMenuRef} className="code-rail-add-menu" role="menu" aria-label="Add to workspace rail">
            <button type="button" role="menuitem" onClick={() => { setIsAddMenuOpen(false); onAddProject() }}>
              <FolderOpen size={14} aria-hidden="true" />
              <span><strong>Add Project</strong><small>Register a folder and its primary workspace</small></span>
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={projectRows.length === 0}
              onClick={() => { setIsAddMenuOpen(false); onAddWorkspace() }}
            >
              <BriefcaseBusiness size={14} aria-hidden="true" />
              <span><strong>Add Workspace</strong><small>Create an isolated workspace or worktree</small></span>
            </button>
          </div>
        )}
      </div>

      <div className="code-rail-workspaces-list">
        {projectRows.length === 0 && (
          <div className="code-rail-empty-projects">
            <Folder size={15} aria-hidden="true" />
            <span>No projects yet</span>
            <button type="button" onClick={onAddProject}>Add project</button>
          </div>
        )}
        {projectRows.map((project) => {
          const projectWorkspaces = workspaces
            .filter((workspace) => workspace.project_id === project.id || workspace.id === project.primary_workspace_id)
            .sort((left, right) => {
              if (left.id === project.primary_workspace_id) return -1
              if (right.id === project.primary_workspace_id) return 1
              const leftPinned = workspaceFlags[left.id]?.pinned ? 0 : 1
              const rightPinned = workspaceFlags[right.id]?.pinned ? 0 : 1
              if (leftPinned !== rightPinned) return leftPinned - rightPinned
              return left.display_name.localeCompare(right.display_name)
            })
          const isCollapsed = collapsedProjects.has(project.id)
          const projectIsActive = activeWorkspace?.project_id === project.id || activeWorkspace?.id === project.primary_workspace_id
          const primaryWorkspace = workspaces.find((workspace) => workspace.id === project.primary_workspace_id) ?? projectWorkspaces[0]
          const showWorkspaceRows = shouldShowProjectWorkspaceRows(projectWorkspaces.length)
          return (
            <section key={project.id} className={`code-rail-project-group ${projectIsActive ? 'is-active-project' : ''}`}>
              <div className="code-rail-project-row">
                <button
                  type="button"
                  className="code-rail-project-disclosure"
                  onClick={() => toggleProject(project.id)}
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.display_name}`}
                  aria-expanded={!isCollapsed}
                  title={`${isCollapsed ? 'Expand' : 'Collapse'} ${project.display_name}`}
                >
                  {isCollapsed ? <ChevronRight size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}
                </button>
                <button
                  type="button"
                  className="code-rail-project-select"
                  onContextMenu={(event) => {
                    event.preventDefault()
                    openContextMenuAt(event, 'project', project.id, 220, true)
                  }}
                  onClick={() => {
                    if (primaryWorkspace) {
                      onSelectWorkspace(primaryWorkspace.id)
                      onSelectGlobalSection?.('workspace')
                    }
                  }}
                  title={primaryWorkspace?.available ? primaryWorkspace.root_path : primaryWorkspace?.unavailable_reason ?? project.unavailable_reason ?? project.root_path}
                >
                  {renderProjectIcon(projectIcons[project.id] ?? (project.kind === 'git' ? 'git' : 'folder'))}
                  <span className="code-rail-project-name">{project.display_name}</span>
                  {projectGroups[project.id] && <span className="code-rail-project-group-badge" title={`Group: ${projectGroups[project.id]}`}>{projectGroups[project.id]}</span>}
                  <span className={`code-live-dot ${primaryWorkspace?.available ? '' : 'is-offline'}`} aria-label={primaryWorkspace?.available ? 'Available' : 'Unavailable'} />
                </button>
                <div className="code-rail-project-actions">
                  {renderProjectActions(project)}
                  <button
                    type="button"
                    onClick={() => onAddWorkspace(project.id)}
                    disabled={!primaryWorkspace?.available}
                    aria-label={`Add workspace to ${project.display_name}`}
                    title="Add workspace / worktree"
                  >
                    <Plus size={13} aria-hidden="true" />
                  </button>
                </div>
              </div>
              {!isCollapsed && (
                <div className="code-rail-project-children">
                  {showWorkspaceRows ? projectWorkspaces.map((workspace) => {
                    const isActive = workspace.id === activeWorkspaceId
                    const flags = workspaceFlags[workspace.id] ?? {}
                    return (
                      <div key={workspace.id} className="code-rail-workspace-group">
                        <div className={`code-rail-workspace-row-shell ${isActive && activeGlobalSection === 'workspace' ? 'is-active' : ''}`}>
                          <button
                            type="button"
                            className={`code-rail-workspace-row ${isActive && activeGlobalSection === 'workspace' ? 'is-active' : ''} ${!workspace.available ? 'is-unavailable' : ''}`}
                            onContextMenu={(event) => {
                              event.preventDefault()
                              openContextMenuAt(event, 'workspace', workspace.id, workspace.workspace_kind === 'primary' ? 470 : 520, true)
                            }}
                            onClick={() => {
                              onSelectWorkspace(workspace.id)
                              onSelectGlobalSection?.('workspace')
                            }}
                            title={workspace.available ? workspace.root_path : `${workspace.unavailable_reason ?? 'Workspace unavailable'} — click to retry`}
                            aria-disabled={!workspace.available}
                          >
                            {flags.pinned && <Pin size={11} className="code-rail-workspace-pin" aria-label="Pinned workspace" />}
                            {flags.unread && <span className="code-rail-unread-dot" aria-label="Unread workspace" />}
                            <span className="code-rail-workspace-kind-icon">
                              {workspace.workspace_kind === 'managed_worktree' ? <GitBranch size={13} aria-hidden="true" /> : <Folder size={13} aria-hidden="true" />}
                            </span>
                            <span className="code-rail-workspace-name">{workspace.display_name}</span>
                            {!workspace.available && <CircleAlert size={12} className="code-rail-warning-icon" aria-label="Workspace unavailable; click to retry" />}
                            {workspace.workspace_kind === 'managed_worktree' && <span className="code-rail-kind-label">isolated</span>}
                          </button>
                          {renderWorkspaceActions(workspace)}
                        </div>
                        {renderPaneTree(workspace.id)}
                      </div>
                    )
                  }) : primaryWorkspace && renderPaneTree(primaryWorkspace.id)}
                </div>
              )}
            </section>
          )
        })}
      </div>

      <footer className="code-rail-footer">
        <div className="code-rail-footer-metric"><span>Notch</span><span className="code-rail-toggle-pill">Off</span></div>
        <div className="code-rail-footer-metric"><span>Credits</span><span className="code-rail-credits-value">9,684</span></div>
        <div className="code-rail-user-card">
          <div className="code-rail-user-left">
            <div className="code-rail-avatar">A</div>
            <div className="code-rail-user-info"><span className="code-rail-username">Developer</span><span className="code-rail-user-badge">PRO</span></div>
          </div>
          <div className="code-rail-user-actions">
            <button type="button" className="code-rail-user-icon-btn" title="Theme preferences are not configured" disabled><Moon size={14} aria-hidden="true" /></button>
            <button type="button" className="code-rail-user-icon-btn" title="Open settings" onClick={() => window.dispatchEvent(new Event('hiveory-open-global-settings'))}><Settings size={14} aria-hidden="true" /></button>
          </div>
        </div>
      </footer>

      {renderActiveContextMenu()}

      <CodeProjectGroupDialog
        open={projectGroupDialogId !== null}
        project={projectRows.find((project) => project.id === projectGroupDialogId) ?? null}
        currentGroup={projectGroupDialogId ? projectGroups[projectGroupDialogId] ?? null : null}
        onClose={() => setProjectGroupDialogId(null)}
        onSubmit={(groupName) => {
          if (projectGroupDialogId) saveProjectGroup(projectGroupDialogId, groupName)
        }}
      />

      {actionNotice && <div className="code-rail-action-notice" role="status" aria-live="polite">{actionNotice}</div>}

      <div
        className="code-workspace-rail-resizer"
        onPointerDown={handleResizeStart}
        onDoubleClick={handleResetWidth}
        title="Drag to resize sidebar • Double-click to reset"
        aria-label="Resize workspace sidebar"
        role="separator"
        aria-orientation="vertical"
      />
    </aside>
  )
}
