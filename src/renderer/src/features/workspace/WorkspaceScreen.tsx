import { useEffect, useState } from 'react'
import { FolderX } from 'lucide-react'
import type { CliInstanceView, EditorView, WorkspaceView } from '@shared/domain'
import { EmptyState } from '../../components/ui/EmptyState'
import { ErrorBoundary } from '../../components/ui/ErrorBoundary'
import { useAgents, useLayouts, useProjects, useWorkspaces } from '../../stores/data'
import { useEditors } from '../../stores/editors'
import { EditorPane } from '../editor/EditorPane'
import { AgentPane } from '../agents/AgentPane'
import { PaneLayout } from '../panes/PaneLayout'
import { focusTerminal } from '../terminal/terminal-registry'
import { EmptyWorkspace } from './EmptyWorkspace'
import styles from './WorkspaceScreen.module.css'

const NO_AGENTS: CliInstanceView[] = []
const NO_EDITORS: EditorView[] = []
const NO_WORKSPACES: WorkspaceView[] = []

interface WorkspaceScreenProps {
  projectId: string
  workspaceId: string
  focusPaneId?: string
}

/** Orchestrates a Workspace: header, empty state or the agent pane layout. */
export function WorkspaceScreen({ projectId, workspaceId, focusPaneId }: WorkspaceScreenProps) {
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId))
  const workspaces = useWorkspaces((s) => s.byProject[projectId] ?? NO_WORKSPACES)
  const loadWorkspaces = useWorkspaces((s) => s.load)
  const workspace = workspaces.find((w) => w.id === workspaceId)
  const agents = useAgents((s) => s.byWorkspace[workspaceId])
  const loadAgents = useAgents((s) => s.load)
  const editors = useEditors((s) => s.byWorkspace[workspaceId] ?? NO_EDITORS)
  const loadEditors = useEditors((s) => s.load)
  const tree = useLayouts((s) => s.byWorkspace[workspaceId] ?? null)
  const { load: loadLayout, apply } = useLayouts()
  const [clearedHighlight, setClearedHighlight] = useState<string>()
  const highlight = focusPaneId !== clearedHighlight ? focusPaneId : undefined

  useEffect(() => {
    void loadWorkspaces(projectId)
  }, [projectId, loadWorkspaces])

  useEffect(() => {
    void loadAgents(workspaceId)
    void loadEditors(workspaceId)
    void loadLayout(workspaceId)
  }, [workspaceId, loadAgents, loadEditors, loadLayout])

  // Arriving from a Kanban card: focus that agent's terminal and briefly mark its pane.
  useEffect(() => {
    if (!focusPaneId) return
    const focus = setTimeout(() => focusTerminal(focusPaneId), 150)
    const clear = setTimeout(() => setClearedHighlight(focusPaneId), 1200)
    return () => {
      clearTimeout(focus)
      clearTimeout(clear)
    }
  }, [focusPaneId])

  if (!project || (workspaces.length > 0 && !workspace)) {
    return <EmptyState icon={<FolderX />} title="Worktree not found" description="It may have been deleted." />
  }
  if (!workspace) return null

  const list = agents ?? NO_AGENTS
  const byId = new Map(list.map((a) => [a.id, a]))
  const editorById = new Map(editors.map((e) => [e.id, e]))

  return (
    <section className={styles.screen} aria-label={`${workspace.name} worktree`}>
      <div className={styles.body}>
        {agents && list.length === 0 && editors.length === 0 ? (
          <div className={styles.emptySurface}>
            <EmptyWorkspace workspaceId={workspaceId} />
          </div>
        ) : (
          <ErrorBoundary region="Pane layout" resetKey={workspaceId}>
            <PaneLayout
              tree={tree}
              onOperation={(operation) => void apply(workspaceId, operation)}
              renderPane={(paneId, props) => {
                const editor = editorById.get(paneId)
                if (editor) {
                  return (
                    <ErrorBoundary region={`${editor.name} editor`} compact resetKey={editor.id}>
                      <EditorPane editor={editor} {...props} />
                    </ErrorBoundary>
                  )
                }
                const agent = byId.get(paneId)
                if (!agent) return null
                return (
                  <ErrorBoundary region={`${agent.petName}'s pane`} compact resetKey={agent.id}>
                    <AgentPane agent={agent} highlighted={highlight === paneId} {...props} />
                  </ErrorBoundary>
                )
              }}
            />
          </ErrorBoundary>
        )}
      </div>
    </section>
  )
}
