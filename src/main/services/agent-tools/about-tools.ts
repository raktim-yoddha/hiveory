import type { AppSettings, Project, Workspace } from '@shared/domain'
import { appGuideText } from '@shared/hiveory/guide'
import type { ToolDefinition, ToolResult } from './mcp-protocol'
import type { ToolFamily } from './agent-tools'

export const ABOUT_TOOL = 'hiveory_about'

export interface AboutDeps {
  settings: () => AppSettings
  /** The worktree a caller runs in, when it is a Work agent. */
  worktree: (workspaceId: string) => { worktree: Workspace; project: Project } | undefined
  /** MCP servers and apps Hiveory serves to agents right now (names only). */
  connections: () => string[]
}

const onOff = (on: boolean): string => (on ? 'on' : 'off')

/**
 * `hiveory_about` (ADR 0041): any agent, chat or bot asks Hiveory what it is, where the caller runs,
 * the settings that shape what it can do and what it is connected to. Names and switches only: no
 * keys, notes or other people's data.
 */
export class AboutTools implements ToolFamily {
  constructor(private readonly deps: AboutDeps) {}

  handles(name: string): boolean {
    return name === ABOUT_TOOL
  }

  definitions(): ToolDefinition[] {
    return [
      {
        name: ABOUT_TOOL,
        description:
          'What Hiveory (the app you run inside) is and where everything lives, where you are in it, the settings that shape what you can do, and the MCP servers and apps you have. Call it whenever the user asks about Hiveory or you are unsure what it can do.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false }
      }
    ]
  }

  async call(caller: { id: string; workspaceId: string; petName: string }): Promise<ToolResult> {
    const s = this.deps.settings()
    const place = this.deps.worktree(caller.workspaceId)
    const where = place
      ? [
          `You are ${caller.petName}, an agent in worktree "${place.worktree.name}"${place.worktree.kind === 'main' ? ' (the Primary)' : ''} of workspace "${place.project.name}"${place.worktree.git?.branch ? `, on branch ${place.worktree.git.branch}` : ''}.`,
          `Its folder: ${place.worktree.path}.`,
          workspaceSettings(place.project)
        ].join(' ')
      : `You are ${caller.petName}, running in Hiveory outside a Work worktree (a chat or a bot thread).`
    const connected = this.deps.connections()
    const text = [
      '# Where you are',
      where,
      '',
      '# What you can use',
      `Hiveory coordination tools (other agents, panes, the worktree terminal): ${onOff(s.agentTools)}. Built-in browser (browser_* tools; the user watches it): ${onOff(s.browserUse)}. Computer use (computer_* tools): ${onOff(s.computerUse)}.`,
      connected.length ? `MCP servers and apps Hiveory serves you: ${connected.join(', ')}.` : 'No extra MCP servers or apps are connected in Hiveory.',
      `New agents auto-approve permissions: ${onOff(s.defaultAutoApprove)}; open in chat view: ${onOff(s.defaultChatUi)}.`,
      'Skills live in the skills folders each CLI reads; the user manages them (and finds more on skills.sh) in Settings › Skills, MCP & Apps.',
      'You cannot change settings: tell the user where they are (below). The gear at the top right opens Settings.',
      '',
      '# The app',
      appGuideText()
    ].join('\n')
    return { text }
  }
}

const workspaceSettings = (project: Project): string => {
  const s = project.settings ?? {}
  const parts = [
    s.agentView ? `new agents open as ${s.agentView}` : '',
    s.codeHost ? `code host ${s.codeHost}` : '',
    s.issueSource ? `issues from ${s.issueSource}` : '',
    s.baseRef ? `new worktrees start from ${s.baseRef}` : ''
  ].filter(Boolean)
  return parts.length ? `Workspace settings: ${parts.join('; ')}.` : ''
}
