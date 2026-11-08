import { useEffect } from 'react'
import type { HiveoryLink } from '@shared/domain/links'
import { api, subscribe } from '../../lib/api'
import { offerChatDraft, preferredChatCli, useChat } from '../../stores/chat'
import { useProjects, useWorkspaces } from '../../stores/data'
import { useNavigation } from '../../stores/navigation'
import { reportError, useNotices } from '../../stores/notices'
import { agentActions } from '../agents/agent-actions'
import { alertText } from './alerts'
import { sortProjects } from '../projects/project-list'

const RECENT_IN_JUMP_LIST = 6

const shownWorktree = (): string | undefined => {
  const { view } = useNavigation.getState()
  const work = view.type === 'settings' ? view.returnTo : view
  return work.type === 'workspace' ? work.workspaceId : undefined
}

const notice = (message: string): void => useNotices.getState().push({ level: 'warning', message })

/** The worktree a link means: the one named, else its Workspace's last used (Primary first), else the one on screen. */
async function linkTarget(link: HiveoryLink): Promise<{ projectId: string; workspaceId: string } | undefined> {
  const { projects } = useProjects.getState()
  const projectId = link.projectId
  if (projectId) {
    if (!projects.some((p) => p.id === projectId)) return undefined
    await useWorkspaces.getState().ensure(projectId)
    const worktrees = useWorkspaces.getState().byProject[projectId] ?? []
    const named = link.workspaceId ? worktrees.find((w) => w.id === link.workspaceId) : undefined
    const chosen = named ?? worktrees.find((w) => w.kind === 'main') ?? worktrees[0]
    return chosen ? { projectId, workspaceId: chosen.id } : undefined
  }
  const { view } = useNavigation.getState()
  const work = view.type === 'settings' ? view.returnTo : view
  return work.type === 'workspace' ? { projectId: work.projectId, workspaceId: work.workspaceId } : undefined
}

/** Opens what a hiveory:// link names. A prompt becomes a chat's draft: it is never sent for you. */
export async function openHiveoryLink(link: HiveoryLink): Promise<void> {
  const nav = useNavigation.getState()
  if (nav.view.type === 'settings') nav.closeSettings()
  if (useProjects.getState().projects.length === 0) await useProjects.getState().load()
  const target = await linkTarget(link)
  if (link.kind === 'open') {
    if (!target) return notice('That Workspace is not in Hiveory on this computer.')
    if (link.workspaceId && target.workspaceId !== link.workspaceId) notice('That worktree is gone; its Workspace is open.')
    return useNavigation.getState().openWorkspace(target.projectId, target.workspaceId)
  }
  if (!target) return notice(link.projectId ? 'That Workspace is not in Hiveory on this computer.' : 'Open a worktree first, then the link again: its prompt starts a chat there.')
  const project = useProjects.getState().projects.find((p) => p.id === target.projectId)
  if (project?.host) return notice('A Chat UI runs on this computer; that Workspace lives on another machine.')
  if (!useChat.getState().clis.length) await useChat.getState().loadClis()
  const cliId = preferredChatCli(useChat.getState().clis)
  if (!cliId) return notice('Install a chat CLI (Claude Code, Codex, OpenCode…) to start a chat from a link.')
  useNavigation.getState().openWorkspace(target.projectId, target.workspaceId)
  const agent = await agentActions.open(target.workspaceId, cliId, undefined, undefined, true)
  if (agent) offerChatDraft(agent.id, link.prompt)
}

/**
 * The window's native side (ADR 0061): desktop notifications for agents, the taskbar/dock badge,
 * hiveory:// links, and the recent Workspaces of the jump list / dock menu. Mounted once, in the shell.
 */
export function useNativeShell(): void {
  const projects = useProjects((s) => s.projects)

  // Notifications (main sends only what Settings asks for): not when the agent's worktree is on screen.
  useEffect(
    () =>
      subscribe('agent.alert', (update) => {
        if (document.hasFocus() && shownWorktree() === update.workspaceId) return
        void api('app.notify', { ...alertText(update), tag: update.instanceId })
          .then(({ clicked }) => {
            if (clicked) useNavigation.getState().openWorkspace(update.projectId, update.workspaceId, update.instanceId)
          })
          .catch(() => undefined)
      }),
    []
  )

  // The badge: the count now, then every change.
  useEffect(() => {
    const show = (waiting: number): void => void api('app.setAttention', { waiting }).catch(() => undefined)
    void api('agents.attention')
      .then(({ waiting }) => show(waiting))
      .catch(() => undefined)
    return subscribe('agents.attention', ({ waiting }) => show(waiting))
  }, [])

  // Links: the one that started Hiveory, then each one opened while it runs.
  useEffect(() => {
    const open = (link: HiveoryLink): void => void openHiveoryLink(link).catch((error: unknown) => reportError(error, 'Open link'))
    void api('app.pendingLink')
      .then((link) => link && open(link))
      .catch(() => undefined)
    return subscribe('app.link', open)
  }, [])

  // The jump list / dock menu: the Workspaces worked in most recently.
  useEffect(() => {
    const items = sortProjects(projects, 'recent')
      .slice(0, RECENT_IN_JUMP_LIST)
      .map((p) => ({ projectId: p.id, name: p.name.slice(0, 120) || 'Workspace' }))
    void api('app.setRecent', { items }).catch(() => undefined)
  }, [projects])
}
