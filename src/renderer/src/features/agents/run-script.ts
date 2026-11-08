import type { Side, WorkspaceScript } from '@shared/domain'
import { api } from '../../lib/api'
import { useClis, useProjects } from '../../stores/data'
import { useNotices } from '../../stores/notices'
import { agentActions } from './agent-actions'

/** How long a new terminal may take to print its prompt before the command is typed anyway. */
const PROMPT_WAIT_MS = 5000

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** The terminal a script runs in: the first shell of the machine the Workspace lives on. */
const shellFor = (projectId: string): string | undefined => {
  const remote = Boolean(useProjects.getState().projects.find((p) => p.id === projectId)?.host)
  const clis = remote ? (useClis.getState().remote[projectId] ?? []) : useClis.getState().clis
  return clis.find((c) => c.kind === 'shell' && c.available)?.id
}

/**
 * Runs a Workspace script (ADR 0061): a new terminal tab in the worktree, named after the script, with
 * its command typed in once the shell is ready. It is the user's own terminal from then on.
 */
export async function runScript(
  workspaceId: string,
  projectId: string,
  script: WorkspaceScript,
  placement?: { targetPaneId: string; side: Side; asTab?: boolean }
): Promise<void> {
  const remote = Boolean(useProjects.getState().projects.find((p) => p.id === projectId)?.host)
  if (remote && !useClis.getState().remote[projectId]) await useClis.getState().loadRemote(projectId)
  if (!remote && !useClis.getState().clis.length) await useClis.getState().load()
  const shell = shellFor(projectId)
  if (!shell) {
    useNotices.getState().push({ level: 'warning', message: 'No terminal found on that machine to run the script in.' })
    return
  }
  const agent = await agentActions.open(workspaceId, shell, placement, undefined, false)
  if (!agent) return
  // The tab says what runs in it; a name another pane already has keeps the terminal's own.
  void api('agents.rename', { instanceId: agent.id, name: script.name }).catch(() => undefined)
  const started = Date.now()
  while (Date.now() - started < PROMPT_WAIT_MS) {
    const snapshot = await api('terminal.snapshot', { instanceId: agent.id }).catch(() => null)
    if (snapshot && snapshot.data.trim()) break
    await sleep(150)
  }
  await api('terminal.write', { instanceId: agent.id, data: `${script.command}\r` })
}
