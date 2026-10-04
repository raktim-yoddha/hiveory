import { create } from 'zustand'
import type {
  AgentPreset,
  CliDescriptor,
  CliInstanceView,
  CliRuntimeDetails,
  LayoutNode,
  LayoutOperation,
  Project,
  WorkspaceView
} from '@shared/domain'
import type { AppInfo } from '@shared/ipc/contract'
import { api } from '../lib/api'
import { reportError } from './notices'

/**
 * Renderer caches of main-process state. Main is the source of truth; these
 * stores only load, hold and invalidate. Load failures surface as notices.
 */

const load = async <T>(operation: string, fetch: () => Promise<T>, apply: (value: T) => void): Promise<void> => {
  try {
    apply(await fetch())
  } catch (error) {
    reportError(error, operation)
  }
}

interface AppState {
  info: AppInfo | null
  load(): Promise<void>
}

export const useApp = create<AppState>((set) => ({
  info: null,
  load: () => load('Load app info', () => api('app.info'), (info) => set({ info }))
}))

interface ProjectState {
  projects: Project[]
  loaded: boolean
  load(): Promise<void>
}

export const useProjects = create<ProjectState>((set) => ({
  projects: [],
  loaded: false,
  load: () => load('Load projects', () => api('projects.list'), (projects) => set({ projects, loaded: true }))
}))

interface WorkspaceState {
  byProject: Record<string, WorkspaceView[]>
  load(projectId: string): Promise<void>
}

export const useWorkspaces = create<WorkspaceState>((set) => ({
  byProject: {},
  load: (projectId) =>
    load(
      'Load workspaces',
      () => api('workspaces.list', { projectId }),
      (list) => set((s) => ({ byProject: { ...s.byProject, [projectId]: list } }))
    )
}))

interface CliState {
  clis: CliDescriptor[]
  loaded: boolean
  load(refresh?: boolean): Promise<void>
}

export const useClis = create<CliState>((set) => ({
  clis: [],
  loaded: false,
  load: (refresh = false) =>
    load('Detect CLIs', () => api('clis.list', { refresh }), (clis) => set({ clis, loaded: true }))
}))

interface AgentState {
  byWorkspace: Record<string, CliInstanceView[]>
  /** Live runtime details pushed from main; overrides what the last list returned. */
  runtime: Record<string, CliRuntimeDetails>
  load(workspaceId: string): Promise<void>
  setRuntime(instanceId: string, details: CliRuntimeDetails): void
}

export const useAgents = create<AgentState>((set) => ({
  byWorkspace: {},
  runtime: {},
  load: (workspaceId) =>
    load(
      'Load agents',
      () => api('agents.list', { workspaceId }),
      (list) =>
        set((s) => ({
          byWorkspace: { ...s.byWorkspace, [workspaceId]: list },
          runtime: { ...s.runtime, ...Object.fromEntries(list.map((a) => [a.id, a.runtime])) }
        }))
    ),
  setRuntime: (instanceId, details) => set((s) => ({ runtime: { ...s.runtime, [instanceId]: details } }))
}))

interface LayoutState {
  byWorkspace: Record<string, LayoutNode | null>
  load(workspaceId: string): Promise<void>
  apply(workspaceId: string, operation: LayoutOperation): Promise<void>
}

export const useLayouts = create<LayoutState>((set) => ({
  byWorkspace: {},
  load: (workspaceId) =>
    load(
      'Load layout',
      () => api('layout.get', { workspaceId }),
      (tree) => set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: tree } }))
    ),
  apply: (workspaceId, operation) =>
    load(
      'Rearrange panes',
      () => api('layout.apply', { workspaceId, operation }),
      (tree) => set((s) => ({ byWorkspace: { ...s.byWorkspace, [workspaceId]: tree } }))
    )
}))

interface PresetState {
  presets: AgentPreset[]
  loaded: boolean
  load(): Promise<void>
}

export const usePresets = create<PresetState>((set) => ({
  presets: [],
  loaded: false,
  load: () => load('Load presets', () => api('presets.list'), (presets) => set({ presets, loaded: true }))
}))
