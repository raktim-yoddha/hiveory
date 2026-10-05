import type { CliStatus, KanbanCard } from '@shared/domain'
import type { QueenAction, QueenContext } from '@shared/queen/actions'
import type { BrainResult } from '@shared/queen/brain'
import { parseCommand } from '@shared/queen/parse'
import {
  cancelledLine,
  doneLine,
  failedLine,
  receipt,
  reportLine,
  undoneLine,
  unknownLine,
  type QueenOutcome,
  type QueenPrefs
} from '@shared/queen/personas'
import { buildReport, type QueenAgentStatus } from '@shared/queen/report'
import { api, HiveoryError } from '../../lib/api'
import { useAgents, useClis, usePresets, useProjects, useSettings, useWorkspaces } from '../../stores/data'
import { selectedProjectId, selectedWorkspaceId, useNavigation, type View } from '../../stores/navigation'
import { agentActions } from '../agents/agent-actions'
import { openBrowserTab } from '../side-panel/panel-actions'
import { useQueen } from './useQueen'

/**
 * Queen Bee's executor (ADR 0019): parse → resolve against live state → run →
 * receipts. Every id an action carries was resolved from the context built here,
 * and is checked again before use, so a stale or wrong id fails loudly instead
 * of touching the wrong agent.
 */

const prefs = (): QueenPrefs => {
  const s = useSettings.getState().settings
  return { persona: s.queenPersona, callMe: s.queenCallMe, honorific: s.queenHonorific, hype: s.queenHype, nudgeMinutes: s.queenNudgeMinutes, length: s.queenLength }
}

class QueenError extends Error {}

const ensure = async <T>(loaded: boolean, load: () => Promise<void>, get: () => T): Promise<T> => {
  if (!loaded) await load()
  return get()
}

/** Every agent of a project, from main (the board covers workspaces the renderer never loaded), plus loaded terminal panes. */
const projectAgents = async (projectId: string): Promise<KanbanCard[]> => {
  const board = await api('kanban.board', { projectId })
  const cards = [...board['waiting-for-you'], ...board.working, ...board.idle]
  const workspaces = useWorkspaces.getState().byProject[projectId] ?? []
  const { byWorkspace, runtime } = useAgents.getState()
  for (const ws of workspaces) {
    for (const a of byWorkspace[ws.id] ?? []) {
      if (!cards.some((c) => c.instanceId === a.id)) {
        cards.push({ instanceId: a.id, cliId: a.cliId, petName: a.petName, workspaceId: ws.id, workspaceName: ws.name, runtime: runtime[a.id] ?? a.runtime })
      }
    }
  }
  return cards
}

async function buildContext(): Promise<{ ctx: QueenContext; cards: KanbanCard[] }> {
  const nav = useNavigation.getState()
  const projectId = selectedProjectId(nav.view)
  const workspaceId = selectedWorkspaceId(nav.view)
  const projects = useProjects.getState()
  const clis = useClis.getState()
  const presets = usePresets.getState()
  const [projectList, cliList, presetList] = await Promise.all([
    ensure(projects.loaded, projects.load, () => useProjects.getState().projects),
    ensure(clis.loaded, () => clis.load(), () => useClis.getState().clis),
    ensure(presets.loaded, presets.load, () => usePresets.getState().presets)
  ])
  let workspaces = projectId ? useWorkspaces.getState().byProject[projectId] : undefined
  if (projectId && !workspaces) {
    await useWorkspaces.getState().load(projectId)
    workspaces = useWorkspaces.getState().byProject[projectId]
  }
  const cards = projectId ? await projectAgents(projectId) : []
  return {
    cards,
    ctx: {
      mode: nav.mode,
      projectId,
      workspaceId,
      projects: projectList.map((p) => ({ id: p.id, name: p.name })),
      workspaces: (workspaces ?? []).map((w) => ({ id: w.id, name: w.name, kind: w.kind })),
      agents: cards.map((c) => ({ id: c.instanceId, petName: c.petName, cliId: c.cliId, workspaceId: c.workspaceId, status: c.runtime.status })),
      clis: cliList.filter((c) => c.available).map((c) => ({ id: c.id, displayName: c.displayName })),
      presets: presetList.map((p) => ({ id: p.id, name: p.name }))
    }
  }
}

const cliName = (cliId: string): string => useClis.getState().clis.find((c) => c.id === cliId)?.displayName ?? cliId

/** Status report over the current project, or every project from the home page. Numbers only from live state. */
async function report(focus: 'all' | CliStatus, projectId: string | undefined) {
  const projectIds = projectId ? [projectId] : useProjects.getState().projects.map((p) => p.id)
  const { since } = useAgents.getState()
  const now = Date.now()
  const perProject = await Promise.all(projectIds.map(async (id) => (await projectAgents(id)).map((card) => ({ card, projectId: id }))))
  const agents: QueenAgentStatus[] = perProject.flat().map(({ card: c, projectId: pid }) => ({
    id: c.instanceId,
    projectId: pid,
    workspaceId: c.workspaceId,
    petName: c.petName,
    cliName: cliName(c.cliId),
    workspaceName: c.workspaceName,
    status: c.runtime.status,
    waitingMinutes: c.runtime.status === 'waiting-for-you' && since[c.instanceId] ? (now - since[c.instanceId]!) / 60_000 : undefined,
    activity: c.runtime.activity
  }))
  return buildReport(agents, focus)
}

/** Runs actions in order. Stops at the first failure; what already ran stays (and is reported). */
async function execute(actions: QueenAction[], ctx: QueenContext, cards: KanbanCard[]): Promise<void> {
  const queen = useQueen.getState()
  const p = prefs()
  const outcomes: QueenOutcome[] = []
  const undos: Array<() => Promise<void> | void> = []
  let reportText: string | null = null
  let reportData: Awaited<ReturnType<typeof report>> | undefined
  const nav = useNavigation.getState
  const workspaceName = (id: string) => ctx.workspaces.find((w) => w.id === id)?.name ?? 'this workspace'
  const agent = (id: string) => {
    const card = cards.find((c) => c.instanceId === id)
    if (!card) throw new QueenError('that agent is no longer open.')
    return card
  }
  /** Navigation steps undo to the page (and mode) that was showing before them. */
  const remember = (): void => {
    const { view, mode } = nav()
    undos.push(() => useNavigation.setState({ view: view as View, mode }))
  }

  try {
    for (const action of actions) {
      switch (action.type) {
        case 'open-agents': {
          if (!ctx.workspaces.some((w) => w.id === action.workspaceId)) throw new QueenError('that workspace no longer exists.')
          if (selectedWorkspaceId(nav().view) !== action.workspaceId) {
            remember()
            nav().openWorkspace(action.projectId, action.workspaceId)
          }
          const opened: string[] = []
          for (let i = 0; i < action.count; i++) {
            const created = await agentActions.open(action.workspaceId, action.cliId)
            if (!created) break
            opened.push(created.id)
          }
          if (!opened.length) throw new QueenError(`${cliName(action.cliId)} did not start.`)
          undos.push(async () => {
            for (const id of opened) await agentActions.close({ id, workspaceId: action.workspaceId })
          })
          outcomes.push({ kind: 'opened', count: opened.length, cliName: cliName(action.cliId), workspace: workspaceName(action.workspaceId) })
          break
        }
        case 'close-agents': {
          const targets = action.agentIds.map(agent)
          for (const t of targets) await agentActions.close({ id: t.instanceId, workspaceId: t.workspaceId })
          outcomes.push({ kind: 'closed', names: targets.map((t) => t.petName) })
          break
        }
        case 'restart-agent': {
          const a = agent(action.agentId)
          await agentActions.restart(a.instanceId)
          outcomes.push({ kind: 'restarted', name: a.petName })
          break
        }
        case 'focus-agent': {
          const a = agent(action.agentId)
          remember()
          nav().openWorkspace(action.projectId, a.workspaceId, a.instanceId)
          outcomes.push({ kind: 'focused', name: a.petName })
          break
        }
        case 'message-agent': {
          const a = agent(action.agentId)
          await api('agents.sendMessage', { instanceId: a.instanceId, message: action.text })
          outcomes.push({ kind: 'messaged', name: a.petName })
          break
        }
        case 'apply-preset': {
          const preset = ctx.presets.find((x) => x.id === action.presetId)
          if (!preset) throw new QueenError('that preset no longer exists.')
          if (selectedWorkspaceId(nav().view) !== action.workspaceId) {
            remember()
            nav().openWorkspace(action.projectId, action.workspaceId)
          }
          await agentActions.applyPreset(action.workspaceId, action.presetId)
          outcomes.push({ kind: 'preset', name: preset.name, workspace: workspaceName(action.workspaceId) })
          break
        }
        case 'navigate': {
          remember()
          if (action.to === 'home') {
            nav().closeSettings()
            nav().goHome()
            outcomes.push({ kind: 'navigated', place: 'Home' })
          } else if (action.to === 'settings') {
            nav().openSettings(action.section)
            outcomes.push({ kind: 'navigated', place: `Settings › ${action.section === 'queen' ? 'Queen Bee' : action.section.charAt(0).toUpperCase() + action.section.slice(1)}` })
          } else if (action.to === 'project') {
            const project = ctx.projects.find((x) => x.id === action.projectId)
            if (!project) throw new QueenError('that project is no longer open.')
            nav().openProject(project.id)
            outcomes.push({ kind: 'navigated', place: project.name })
          } else {
            nav().openWorkspace(action.projectId, action.workspaceId)
            outcomes.push({ kind: 'navigated', place: workspaceName(action.workspaceId) })
          }
          break
        }
        case 'set-mode': {
          remember()
          nav().setMode(action.mode)
          outcomes.push({ kind: 'mode', mode: action.mode === 'chatspace' ? 'Chat' : 'Work' })
          break
        }
        case 'side-panel': {
          if (nav().panelOpen !== action.open) nav().togglePanel()
          undos.push(() => {
            if (nav().panelOpen === action.open) nav().togglePanel()
          })
          outcomes.push({ kind: 'panel', what: action.open ? 'side panel' : 'side panel closed' })
          break
        }
        case 'open-panel-tab': {
          const scope = selectedWorkspaceId(nav().view) ?? selectedProjectId(nav().view)
          if (!scope) throw new QueenError('open a project or workspace first.')
          if (!nav().panelOpen) nav().togglePanel()
          if (action.kind === 'browser') {
            if (!(await openBrowserTab(scope))) throw new QueenError('the browser did not open.')
          } else nav().addPanelTab(scope, 'explorer')
          outcomes.push({ kind: 'panel', what: action.kind })
          break
        }
        case 'report': {
          reportData = await report(action.focus, ctx.projectId)
          reportText = reportLine(reportData, p)
          break
        }
      }
    }
  } catch (error) {
    const message = error instanceof QueenError ? error.message : error instanceof Error ? error.message : String(error)
    queen.show({ kind: 'reply', text: failedLine(message, p), receipts: outcomes.map(receipt) })
    return
  }

  const text = [reportText, outcomes.length ? doneLine(outcomes, p) : null].filter(Boolean).join(' ')
  queen.show({
    kind: 'reply',
    text,
    receipts: outcomes.map(receipt),
    report: reportData,
    undo: undos.length
      ? async () => {
          for (const undo of undos.reverse()) await undo()
          useQueen.getState().show({ kind: 'reply', text: undoneLine(p), receipts: [] })
        }
      : undefined
  })
}

/** The model tier. No model configured reads as "unknown"; any other failure is shown as it is. */
async function askBrain(input: string, ctx: QueenContext): Promise<BrainResult> {
  try {
    return await api('queen.plan', { utterance: input, context: ctx })
  } catch (error) {
    if (error instanceof HiveoryError && error.error.code === 'NOT_FOUND') return { kind: 'unknown' }
    throw error
  }
}

/** Handles one command typed (or, later, spoken) to Queen Bee. */
export async function runQueen(input: string): Promise<void> {
  const queen = useQueen.getState()
  if (!input.trim() || queen.busy) return
  queen.setBusy(true)
  try {
    const { ctx, cards } = await buildContext()
    let parsed: BrainResult = parseCommand(input, ctx)
    const p = prefs()
    // Tier 1: only what the rules could not place goes to the model (when one is set up).
    if (parsed.kind === 'unknown') parsed = await askBrain(input, ctx)
    if (parsed.kind === 'unknown') queen.show({ kind: 'reply', text: unknownLine(p), receipts: [] })
    else if (parsed.kind === 'reply') queen.show({ kind: 'reply', text: parsed.text, receipts: [] })
    else if (parsed.kind === 'ask') queen.show({ kind: 'ask', question: parsed.question })
    else if (parsed.confirm) {
      const closes = parsed.actions.some((a) => a.type === 'close-agents')
      const sends = parsed.actions.some((a) => a.type === 'message-agent')
      queen.show({ kind: 'confirm', text: parsed.confirm, label: closes && sends ? 'Confirm' : closes ? 'Close' : 'Send', run: () => execute(parsed.actions, ctx, cards) })
    }
    else await execute(parsed.actions, ctx, cards)
  } catch (error) {
    queen.show({ kind: 'reply', text: failedLine(error instanceof Error ? error.message : String(error), prefs()), receipts: [] })
  } finally {
    useQueen.getState().setBusy(false)
  }
}

/** The user said no to a confirmation. */
export const cancelQueen = (): void => useQueen.getState().show({ kind: 'reply', text: cancelledLine(prefs()), receipts: [] })
