import { useEffect, useMemo } from 'react'
import { APP_COMMANDS, bindingOf } from '@shared/keys/keybindings'
import { shortcutLabel } from '@shared/keys/shortcut'
import { usePlatform } from '../../../lib/platform'
import { useHostClis, useProjects, useSettings, useWorkspaces } from '../../../stores/data'
import { readSort, sortProjects } from '../../projects/project-list'
import { useNavigation, type PanelTab, type SettingsSection } from '../../../stores/navigation'
import { agentActions } from '../../agents/agent-actions'
import { useChatUi } from '../../agents/useChatUi'
import { runScript } from '../../agents/run-script'
import { openLink } from '@shared/domain/links'
import { api } from '../../../lib/api'
import { runAction } from '../../../stores/notices'
import { runAppCommand } from '../useAppShortcuts'
import { openReview } from '../../changes/changes-store'
import type { PaletteItem } from './palette-rank'

const PANEL_TABS: Array<{ kind: PanelTab['kind']; label: string }> = [
  { kind: 'changes', label: 'Changes' },
  { kind: 'workspace', label: 'Dashboard' },
  { kind: 'pull', label: 'Pull request' },
  { kind: 'explorer', label: 'Explorer' },
  { kind: 'sessions', label: 'Sessions' }
]

const SETTINGS: Array<{ id: SettingsSection; label: string }> = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'agents', label: 'Agents' },
  { id: 'browser', label: 'Browser' },
  { id: 'extensions', label: 'Skills, MCPs & Apps' },
  { id: 'integrations', label: 'Integrations' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'remote', label: 'Remote' },
  { id: 'usage', label: 'Usage' },
  { id: 'updates', label: 'Updates' },
  { id: 'guide', label: 'Guide' },
  { id: 'about', label: 'About' }
]

/**
 * Everything the command palette offers (ADR 0060), open worktree first: open an agent or a chat
 * there and its side panel tabs, then every Workspace and worktree, the app's commands with their
 * keys, and each Settings page. Built from the live stores, never a fixed list of CLIs.
 */
export function usePaletteItems(open: boolean): PaletteItem[] {
  const view = useNavigation((s) => (s.view.type === 'settings' ? s.view.returnTo : s.view))
  const projects = useProjects((s) => s.projects)
  const byProject = useWorkspaces((s) => s.byProject)
  const ensure = useWorkspaces((s) => s.ensure)
  const keybindings = useSettings((s) => s.settings.keybindings)
  const platform = usePlatform()
  const here = view.type === 'workspace' ? view : undefined
  const { clis } = useHostClis(here?.projectId)
  const chatUi = useChatUi(here?.workspaceId ?? '', here?.projectId)

  // Every Workspace's worktrees, so a closed one in the sidebar can be found too.
  useEffect(() => {
    if (open) for (const p of projects) void ensure(p.id)
  }, [open, projects, ensure])

  return useMemo(() => {
    const nav = () => useNavigation.getState()
    const items: PaletteItem[] = []
    if (here) {
      if (chatUi) items.push({ id: 'chat-ui', group: 'Open here', label: 'Chat UI', hint: 'chat with any CLI', run: () => chatUi() })
      for (const cli of clis.filter((c) => c.available)) {
        items.push({ id: `cli:${cli.id}`, group: 'Open here', label: cli.displayName, run: () => void agentActions.open(here.workspaceId, cli.id) })
      }
      for (const s of projects.find((p) => p.id === here.projectId)?.settings?.scripts ?? []) {
        items.push({ id: `script:${s.name}`, group: 'Run script', label: s.name, hint: s.command, run: () => void runScript(here.workspaceId, here.projectId, s) })
      }
      // A hiveory:// link back to this worktree, for notes, chats and other apps (ADR 0061).
      items.push({ id: 'copy-link', group: 'This worktree', label: 'Copy a link to this worktree', run: () => void runAction('Copy link', () => api('clipboard.writeText', { text: openLink(here.projectId, here.workspaceId) })) })
      items.push({ id: 'review', group: 'This worktree', label: 'Review changes', hint: 'every changed file in a pane', run: () => void openReview(here.workspaceId) })
      items.push({ id: 'workspace-settings', group: 'This worktree', label: 'Workspace settings', run: () => nav().openSettings('workspace', here.projectId) })
      for (const tab of PANEL_TABS) items.push({ id: `panel:${tab.kind}`, group: 'Side panel', label: tab.label, run: () => nav().showPanelTab(here.workspaceId, tab.kind) })
    }
    for (const project of sortProjects(projects, readSort())) {
      items.push({ id: `project:${project.id}`, group: 'Go to', label: project.name, hint: 'Workspace', run: () => nav().openProject(project.id) })
      for (const w of byProject[project.id] ?? []) {
        if (here?.workspaceId === w.id) continue
        items.push({ id: `worktree:${w.id}`, group: 'Go to', label: w.name, hint: `${project.name}${w.git?.branch ? ` · ${w.git.branch}` : ''}`, run: () => nav().openWorkspace(project.id, w.id) })
      }
    }
    for (const c of APP_COMMANDS) {
      if (c.id === 'command-palette') continue
      const keys = bindingOf(c.id, keybindings, platform)
      items.push({ id: `command:${c.id}`, group: c.group === 'General' ? 'Commands' : c.group, label: c.label, ...(keys ? { keys: shortcutLabel(keys, platform) } : {}), run: () => void runAppCommand(c.id) })
    }
    for (const s of SETTINGS) items.push({ id: `settings:${s.id}`, group: 'Settings', label: s.label, run: () => nav().openSettings(s.id) })
    return items
  }, [here, chatUi, clis, projects, byProject, keybindings, platform])
}
