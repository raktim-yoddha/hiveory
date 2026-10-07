import { THEMES, type CliStatus, type KanbanCard } from '@shared/domain'
import type { QueenAction, QueenContext } from '@shared/queen/actions'
import type { BrainResult } from '@shared/queen/brain'
import { parseCommand } from '@shared/queen/parse'
import { smallTalkLine } from '@shared/queen/chat'
import {
  cancelledLine,
  detailLine,
  doneLine,
  failedLine,
  helpLine,
  nobodyWaitingLine,
  nothingToForgetLine,
  personaInfo,
  prefsFromSettings,
  recallLine,
  receipt,
  reportLine,
  undoneLine,
  unknownLine,
  type QueenOutcome,
  type QueenPrefs
} from '@shared/queen/personas'
import { BOTS_PAGE_LABEL, MAX_NOTES, MODE_LABEL, QUEEN_SETTINGS } from '@shared/queen/actions'
import { buildReport, type QueenAgentStatus } from '@shared/queen/report'
import { api, HiveoryError } from '../../lib/api'
import { useBots } from '../../stores/bots'
import { useChat } from '../../stores/chat'
import { useRoutines } from '../../stores/routines'
import { useTriggers } from '../../stores/triggers'
import { useAgents, useClis, useLayouts, usePresets, useProjects, useSettings, useWorkspaces } from '../../stores/data'
import { selectedProjectId, selectedWorkspaceId, useNavigation, type View } from '../../stores/navigation'
import { agentActions } from '../agents/agent-actions'
import { openBrowserTab } from '../side-panel/panel-actions'
import { useQueen } from './useQueen'
import { cue, speak } from './voice'

/**
 * Queen Bee's executor (ADR 0019): parse → resolve against live state → run →
 * receipts. Every id an action carries was resolved from the context built here,
 * and is checked again before use, so a stale or wrong id fails loudly instead
 * of touching the wrong agent.
 */

const prefs = (): QueenPrefs => prefsFromSettings(useSettings.getState().settings)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Waits until a just-opened agent can take a message: running, idle for 2 s and
 * something on its screen. A question first (trust this folder?) stops the wait:
 * typing into it would answer it.
 */
async function waitUntilReady(instanceId: string, timeoutMs = 60_000): Promise<'ready' | 'waiting' | 'stopped' | 'timeout'> {
  const started = Date.now()
  let idleSince: number | null = null
  for (;;) {
    const r = useAgents.getState().runtime[instanceId]
    const now = Date.now()
    if (r?.status === 'waiting-for-you') return 'waiting'
    if (r && !r.running && now - started > 5000) return 'stopped'
    if (r?.running && r.status === 'idle') {
      idleSince ??= now
      if (now - idleSince >= 2000 && now - started >= 3000) {
        const peek = await api('queen.peek', { instanceId }).catch(() => null)
        if (peek?.excerpt) return 'ready'
      }
    } else idleSince = null
    if (now - started > timeoutMs) return 'timeout'
    await sleep(250)
  }
}

/** Her notes (Settings › Queen Bee › Personality), saved through settings. */
const notes = (): string[] => useSettings.getState().settings.queenMemory
const saveNotes = (next: string[]): Promise<void> => useSettings.getState().update({ queenMemory: next })

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
  const bots = useBots.getState()
  const routines = useRoutines.getState()
  const triggers = useTriggers.getState()
  const [projectList, cliList, presetList, botList, routineList, triggerList] = await Promise.all([
    ensure(projects.loaded, projects.load, () => useProjects.getState().projects),
    ensure(clis.loaded, () => clis.load(), () => useClis.getState().clis),
    ensure(presets.loaded, presets.load, () => usePresets.getState().presets),
    ensure(bots.loaded, bots.load, () => useBots.getState().bots).catch(() => []),
    ensure(routines.loaded, routines.load, () => useRoutines.getState().routines).catch(() => []),
    ensure(triggers.loaded, triggers.load, () => useTriggers.getState().triggers).catch(() => [])
  ])
  let workspaces = projectId ? useWorkspaces.getState().byProject[projectId] : undefined
  if (projectId && !workspaces) {
    await useWorkspaces.getState().load(projectId)
    workspaces = useWorkspaces.getState().byProject[projectId]
  }
  // Every other project's workspaces too, so "go to main" can ask which project's Main.
  const others = projectList.filter((p) => p.id !== projectId)
  await Promise.all(others.filter((p) => !useWorkspaces.getState().byProject[p.id]).map((p) => useWorkspaces.getState().load(p.id).catch(() => undefined)))
  const otherWorkspaces = others.flatMap((p) => (useWorkspaces.getState().byProject[p.id] ?? []).map((w) => ({ id: w.id, name: w.name, kind: w.kind, projectId: p.id })))
  const cards = projectId ? await projectAgents(projectId) : []
  return {
    cards,
    ctx: {
      mode: nav.mode,
      projectId,
      workspaceId,
      projects: projectList.map((p) => ({ id: p.id, name: p.name })),
      workspaces: (workspaces ?? []).map((w) => ({ id: w.id, name: w.name, kind: w.kind })),
      otherWorkspaces,
      agents: cards.map((c) => ({ id: c.instanceId, petName: c.petName, cliId: c.cliId, workspaceId: c.workspaceId, status: c.runtime.status })),
      clis: cliList.filter((c) => c.available).map((c) => ({ id: c.id, displayName: c.displayName, kind: c.kind })),
      presets: presetList.map((p) => ({ id: p.id, name: p.name })),
      bots: botList.map((b) => ({ id: b.id, name: b.name })),
      automations: [
        ...routineList.map((r) => ({ id: r.id, name: r.name, kind: 'routine' as const, on: r.enabled })),
        ...triggerList.map((t) => ({ id: t.id, name: t.name, kind: 'trigger' as const, on: t.enabled }))
      ],
      ...(useSettings.getState().settings.queenPersona === 'custom' ? { queenName: personaInfo(useSettings.getState().settings).name } : {})
    }
  }
}

const cliName = (cliId: string): string => useClis.getState().clis.find((c) => c.id === cliId)?.displayName ?? cliId

/** Status report over the current project, or every project (from Home, or when asked). Numbers only from live state. */
async function report(focus: 'all' | CliStatus, projectId: string | undefined, options: { everywhere?: boolean; cliId?: string } = {}) {
  const projectIds = projectId && !options.everywhere ? [projectId] : useProjects.getState().projects.map((p) => p.id)
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
    activity: c.runtime.activity,
    cliId: c.cliId
  }))
  return buildReport(
    agents.filter((a) => !options.cliId || a.cliId === options.cliId),
    focus
  )
}

/** Runs actions in order. Stops at the first failure; what already ran stays (and is reported). */
async function execute(actions: QueenAction[], ctx: QueenContext, cards: KanbanCard[]): Promise<void> {
  const queen = useQueen.getState()
  const p = prefs()
  const outcomes: QueenOutcome[] = []
  const undos: Array<() => Promise<void> | void> = []
  let reportText: string | null = null
  let reportData: Awaited<ReturnType<typeof report>> | undefined
  /** The agent's own last words, shown labelled under the reply. */
  let quote: string | undefined
  const nav = useNavigation.getState
  const workspaceName = (id: string) => [...ctx.workspaces, ...(ctx.otherWorkspaces ?? [])].find((w) => w.id === id)?.name ?? 'this worktree'
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
          if (!ctx.workspaces.some((w) => w.id === action.workspaceId)) throw new QueenError('that worktree no longer exists.')
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
          // "tell everyone …" is one step with every name, not one step per agent.
          const last = outcomes.at(-1)
          if (last?.kind === 'messaged') last.name = `${last.name}, ${a.petName}`
          else outcomes.push({ kind: 'messaged', name: a.petName })
          break
        }
        case 'open-and-message': {
          if (!ctx.workspaces.some((w) => w.id === action.workspaceId)) throw new QueenError('that worktree no longer exists.')
          if (selectedWorkspaceId(nav().view) !== action.workspaceId) {
            remember()
            nav().openWorkspace(action.projectId, action.workspaceId)
          }
          const created = await agentActions.open(action.workspaceId, action.cliId)
          if (!created) throw new QueenError(`${cliName(action.cliId)} did not start.`)
          outcomes.push({ kind: 'opened', count: 1, cliName: cliName(action.cliId), workspace: workspaceName(action.workspaceId) })
          useQueen.getState().show({ kind: 'reply', text: `Starting ${created.petName}; I'll send your message when it's ready.`, receipts: outcomes.map(receipt) })
          const ready = await waitUntilReady(created.id)
          if (ready !== 'ready') {
            throw new QueenError(
              ready === 'waiting'
                ? `${created.petName} is asking something first. Answer it, then tell me again.`
                : ready === 'stopped'
                  ? `${created.petName} stopped before it was ready.`
                  : `${created.petName} took too long to start; the message was not sent.`
            )
          }
          await api('agents.sendMessage', { instanceId: created.id, message: action.text })
          outcomes.push({ kind: 'messaged', name: created.petName })
          break
        }
        case 'interrupt-agent': {
          const a = agent(action.agentId)
          await api('agents.interrupt', { instanceId: a.instanceId })
          const last = outcomes.at(-1)
          if (last?.kind === 'interrupted') last.names.push(a.petName)
          else outcomes.push({ kind: 'interrupted', names: [a.petName] })
          break
        }
        case 'agent-detail': {
          const a = agent(action.agentId)
          const peek = await api('queen.peek', { instanceId: a.instanceId })
          reportText = detailLine(peek, p, cliName(a.cliId))
          quote = peek.excerpt
          reportData = buildReport([{ id: a.instanceId, projectId: ctx.projectId, workspaceId: a.workspaceId, petName: a.petName, cliName: cliName(a.cliId), workspaceName: a.workspaceName, status: peek.status }], 'all')
          break
        }
        case 'focus-waiting': {
          const waiting = (await report('waiting-for-you', ctx.projectId)).waiting[0] ?? (await report('waiting-for-you', undefined, { everywhere: true })).waiting[0]
          if (!waiting?.projectId || !waiting.workspaceId) {
            reportText = nobodyWaitingLine(p)
            break
          }
          remember()
          nav().openWorkspace(waiting.projectId, waiting.workspaceId, waiting.id)
          outcomes.push({ kind: 'focused', name: waiting.petName })
          break
        }
        case 'set-theme': {
          const before = useSettings.getState().settings.theme
          await useSettings.getState().update({ theme: action.theme })
          undos.push(() => useSettings.getState().update({ theme: before }))
          outcomes.push({ kind: 'theme', name: THEMES.find((t) => t.id === action.theme)?.name ?? action.theme })
          break
        }
        case 'speak': {
          await useSettings.getState().update({ queenTalkback: action.on ? 'always' : 'never' })
          outcomes.push({ kind: 'talkback', on: action.on })
          break
        }
        case 'create-workspace': {
          const settings = useSettings.getState().settings
          const created = await api('workspaces.create', {
            projectId: action.projectId,
            kind: 'isolated',
            name: action.name,
            cliSelections: [],
            autoApprove: settings.defaultAutoApprove,
            chatUi: settings.defaultChatUi
          })
          remember()
          nav().openWorkspace(action.projectId, created.id)
          outcomes.push({ kind: 'workspace', name: created.name })
          break
        }
        case 'help': {
          reportText = helpLine(p)
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
            if (!project) throw new QueenError('that workspace is no longer open.')
            nav().openProject(project.id)
            outcomes.push({ kind: 'navigated', place: project.name })
          } else if (action.to === 'bots') {
            nav().setMode('bots')
            const bots = useBots.getState()
            ;({ work: bots.showWorkBoard, routines: () => bots.showRoutines(), triggers: bots.showTriggers, 'team-map': bots.showTeamMap })[action.page]()
            outcomes.push({ kind: 'navigated', place: BOTS_PAGE_LABEL[action.page] })
          } else {
            nav().openWorkspace(action.projectId, action.workspaceId)
            const project = action.projectId !== ctx.projectId ? ctx.projects.find((x) => x.id === action.projectId)?.name : undefined
            outcomes.push({ kind: 'navigated', place: project ? `${project} · ${workspaceName(action.workspaceId)}` : workspaceName(action.workspaceId) })
          }
          break
        }
        case 'set-mode': {
          remember()
          nav().setMode(action.mode)
          outcomes.push({ kind: 'mode', mode: MODE_LABEL[action.mode] })
          break
        }
        case 'side-panel': {
          if (action.open && nav().view.type !== 'workspace') throw new QueenError('the side panel is only in worktrees. Open one first.')
          if (nav().panelOpen !== action.open) nav().togglePanel()
          undos.push(() => {
            if (nav().panelOpen === action.open) nav().togglePanel()
          })
          outcomes.push({ kind: 'panel', what: action.open ? 'side panel' : 'side panel closed' })
          break
        }
        case 'open-panel-tab': {
          const scope = selectedWorkspaceId(nav().view)
          if (!scope) throw new QueenError('the side panel is only in worktrees. Open one first.')
          if (!nav().panelOpen) nav().togglePanel()
          if (action.kind === 'browser') {
            if (!(await openBrowserTab(scope))) throw new QueenError('the browser did not open.')
          } else nav().addPanelTab(scope, 'explorer')
          outcomes.push({ kind: 'panel', what: action.kind })
          break
        }
        case 'report': {
          reportData = await report(action.focus, ctx.projectId, { everywhere: action.everywhere, cliId: action.cliId })
          reportText = reportLine(reportData, p)
          break
        }
        case 'remember': {
          const before = notes()
          if (!before.some((n) => n.toLowerCase() === action.text.toLowerCase())) {
            if (before.length >= MAX_NOTES) throw new QueenError(`I keep at most ${MAX_NOTES} notes. Remove some in Settings › Queen Bee.`)
            await saveNotes([...before, action.text])
            undos.push(() => saveNotes(notes().filter((n) => n !== action.text)))
          }
          outcomes.push({ kind: 'noted', text: action.text })
          break
        }
        case 'forget': {
          const before = notes()
          const wanted = action.text.toLowerCase()
          const kept = before.filter((n) => !n.toLowerCase().includes(wanted))
          if (kept.length === before.length) {
            reportText = nothingToForgetLine(p)
            break
          }
          await saveNotes(kept)
          undos.push(() => saveNotes(before))
          outcomes.push({ kind: 'forgot', count: before.length - kept.length })
          break
        }
        case 'recall': {
          reportText = recallLine(notes(), p)
          break
        }
        case 'chat': {
          reportText = smallTalkLine(action.topic, p, personaInfo(useSettings.getState().settings).name)
          break
        }
        case 'set-setting': {
          const { key, label } = QUEEN_SETTINGS[action.setting]
          const before = useSettings.getState().settings[key]
          await useSettings.getState().update({ [key]: action.on })
          undos.push(() => useSettings.getState().update({ [key]: before }))
          outcomes.push({ kind: 'setting', name: label, on: action.on })
          break
        }
        case 'open-url': {
          if (selectedWorkspaceId(nav().view) !== action.workspaceId) throw new QueenError('the browser opens in a worktree. Open one first.')
          if (!nav().panelOpen) nav().togglePanel()
          const page = await api('browser.open', { scope: action.workspaceId, url: action.url })
          nav().addPanelTab(action.workspaceId, 'browser', page.id, true, 'top')
          outcomes.push({ kind: 'page', host: new URL(action.url).host })
          break
        }
        case 'open-file': {
          const found = await api('files.search', { scope: { workspaceId: action.workspaceId }, query: action.query })
          const files = found.filter((f) => f.kind === 'file')
          const wanted = action.query.toLowerCase()
          const file = files.find((f) => f.name.toLowerCase() === wanted) ?? files.find((f) => f.path.toLowerCase().endsWith(wanted)) ?? files[0]
          if (!file) throw new QueenError(`there's no file called ${action.query} here.`)
          await api('editors.open', { workspaceId: action.workspaceId, path: file.path })
          outcomes.push({ kind: 'file', name: file.path })
          break
        }
        case 'arrange': {
          if (!useLayouts.getState().byWorkspace[action.workspaceId]) await useLayouts.getState().load(action.workspaceId)
          if (!useLayouts.getState().byWorkspace[action.workspaceId]) throw new QueenError('there are no panes here to arrange.')
          await useLayouts.getState().apply(action.workspaceId, { type: 'arrange', mode: action.layout })
          outcomes.push({ kind: 'arranged', layout: action.layout })
          break
        }
        case 'git-status': {
          const git = await api('workspaces.gitStatus', { workspaceId: action.workspaceId })
          if (!git) {
            reportText = `${workspaceName(action.workspaceId)} isn't a Git repository.`
            break
          }
          const changes = git.changed + git.untracked
          const sync = [git.ahead ? `${git.ahead} ahead` : '', git.behind ? `${git.behind} behind` : ''].filter(Boolean).join(', ')
          reportText = [
            `${git.branch ? `On ${git.branch}` : 'Detached'}:`,
            changes ? `${changes} changed ${changes === 1 ? 'file' : 'files'}${git.untracked ? ` (${git.untracked} new)` : ''}` : 'no changes',
            sync ? `; ${sync} of ${git.upstream ?? 'its upstream'}.` : '.'
          ].join(' ').replace(' ;', ';').replace(' .', '.')
          break
        }
        case 'pull-requests': {
          const prs = await api('github.pullRequests', { projectId: action.projectId })
          reportText = prs.length
            ? `${prs.length} open pull ${prs.length === 1 ? 'request' : 'requests'}: ${prs
                .slice(0, 3)
                .map((pr) => `#${pr.number} ${pr.title}${pr.draft ? ' (draft)' : ''}`)
                .join('; ')}${prs.length > 3 ? '; …' : ''}.`
            : 'No open pull requests.'
          break
        }
        case 'apps-report': {
          const status = await api('apps.status')
          const active = status.accounts.filter((a) => a.status === 'active')
          if (!status.keySet) reportText = 'No apps yet: add your Composio API key in Settings › Skills, MCP & Apps › Apps.'
          else if (status.error) reportText = `Composio can't be reached: ${status.error}`
          else if (!active.length) reportText = 'No apps are connected yet. Connect one in Settings › Skills, MCP & Apps › Apps.'
          else {
            const byApp = new Map<string, string[]>()
            for (const a of active) byApp.set(a.appId, [...(byApp.get(a.appId) ?? []), a.label ?? 'Default'])
            reportText = `Connected: ${[...byApp].map(([app, labels]) => `${app} (${labels.join(', ')})`).join('; ')}.`
          }
          break
        }
        case 'check-updates': {
          const status = await api('updates.check')
          reportText =
            status.state === 'available' || status.state === 'downloaded'
              ? `Hiveory ${status.version} is available. Install it in Settings › Updates.`
              : status.state === 'downloading'
                ? `Hiveory ${status.version} is downloading (${Math.round(status.percent)}%).`
                : status.state === 'unsupported'
                  ? status.reason
                  : status.state === 'error'
                    ? `I couldn't check: ${status.message}`
                    : 'Hiveory is up to date.'
          break
        }
        case 'save-preset': {
          const counts = new Map<string, number>()
          for (const a of ctx.agents) if (a.workspaceId === action.workspaceId) counts.set(a.cliId, (counts.get(a.cliId) ?? 0) + 1)
          if (!counts.size) throw new QueenError('there are no agents here to save.')
          const settings = useSettings.getState().settings
          const existing = ctx.presets.find((x) => x.name.toLowerCase() === action.name.toLowerCase())
          await api('presets.save', {
            ...(existing ? { id: existing.id } : {}),
            name: action.name,
            cliSelections: [...counts].map(([cliId, count]) => ({ cliId, count })),
            autoApprove: settings.defaultAutoApprove,
            chatUi: settings.defaultChatUi
          })
          await usePresets.getState().load()
          outcomes.push({ kind: 'preset-saved', name: action.name })
          break
        }
        case 'new-chat': {
          remember()
          nav().setMode('chatspace')
          await useChat.getState().create(action.projectId)
          const chatId = useChat.getState().activeId
          if (!chatId) throw new QueenError('the chat did not start.')
          if (action.cliId) await useChat.getState().update(chatId, { cliId: action.cliId })
          outcomes.push({ kind: 'chat', ...(action.cliId ? { cliName: cliName(action.cliId) } : {}) })
          if (action.text) {
            if (!(await useChat.getState().send(chatId, action.text))) throw new QueenError('the message was not sent.')
            outcomes.push({ kind: 'messaged', name: 'the chat' })
          }
          break
        }
        case 'message-bot': {
          const bot = ctx.bots?.find((b) => b.id === action.botId)
          if (!bot) throw new QueenError('that bot no longer exists.')
          remember()
          nav().setMode('bots')
          await useBots.getState().select(bot.id)
          await useBots.getState().newThread(bot.id)
          const thread = useBots.getState().activeThread[bot.id]
          if (!thread || !(await useChat.getState().send(thread, action.text))) throw new QueenError(`${bot.name} did not get the message.`)
          outcomes.push({ kind: 'messaged', name: bot.name })
          break
        }
        case 'switch-automation': {
          const item = ctx.automations?.find((x) => x.id === action.automationId)
          if (!item) throw new QueenError('that routine or trigger no longer exists.')
          const flip = async (enabled: boolean): Promise<void> => {
            if (item.kind === 'routine') {
              await api('routines.update', { routineId: item.id, enabled })
              await useRoutines.getState().load()
            } else {
              await api('triggers.update', { triggerId: item.id, enabled })
              await useTriggers.getState().load()
            }
          }
          await flip(action.on)
          undos.push(() => flip(item.on))
          outcomes.push({ kind: 'switched', name: item.name, on: action.on })
          break
        }
        case 'resume-session': {
          if (!ctx.workspaces.some((w) => w.id === action.workspaceId)) throw new QueenError('that worktree no longer exists.')
          const sessions = await api('sessions.list', { scope: 'workspace', workspaceId: action.workspaceId })
          const latest = sessions.filter((s) => s.cliId === action.cliId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
          if (!latest) throw new QueenError(`there's no earlier ${cliName(action.cliId)} conversation here.`)
          if (selectedWorkspaceId(nav().view) !== action.workspaceId) {
            remember()
            nav().openWorkspace(action.projectId, action.workspaceId)
          }
          const created = await agentActions.open(action.workspaceId, action.cliId, undefined, latest.id)
          if (!created) throw new QueenError(`${cliName(action.cliId)} did not start.`)
          undos.push(() => agentActions.close({ id: created.id, workspaceId: action.workspaceId }))
          outcomes.push({ kind: 'resumed', cliName: cliName(action.cliId), title: latest.title.slice(0, 60) })
          break
        }
        case 'add-project': {
          const project = await api('projects.open')
          if (!project) {
            reportText = 'No folder chosen.'
            break
          }
          await useProjects.getState().load()
          remember()
          nav().openProject(project.id)
          outcomes.push({ kind: 'project', name: project.name })
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
    ...(quote ? { quote } : {}),
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

/** The words of the card on screen, for speaking it. */
const cardText = (): string => {
  const card = useQueen.getState().card
  return !card ? '' : card.kind === 'ask' ? card.question.text : card.text
}

/** The last command, for "again". */
let lastCommand = ''
const AGAIN = /^\s*(again|repeat|repeat that|do it again|same again|one more time|phir se|dobara)\s*[.!]?\s*$/i

/** Handles one command typed or spoken to Queen Bee. */
export async function runQueen(said: string, options: { spoken?: boolean } = {}): Promise<void> {
  const queen = useQueen.getState()
  const input = AGAIN.test(said) && lastCommand ? lastCommand : said
  if (!input.trim() || queen.busy) return
  if (!AGAIN.test(input)) lastCommand = input
  queen.setBusy(true)
  try {
    const { ctx, cards } = await buildContext()
    let parsed: BrainResult = parseCommand(input, ctx)
    const p = prefs()
    // Tier 1: only what the rules could not place goes to the model (when one is set up).
    if (parsed.kind === 'unknown') parsed = await askBrain(input, ctx)
    // The rules didn't know a name: a model may. Its plan wins; otherwise the rules' question stands.
    else if (parsed.kind === 'ask' && parsed.soft) {
      const planned = await askBrain(input, ctx).catch(() => ({ kind: 'unknown' }) as const)
      if (planned.kind === 'actions') parsed = planned
    }
    if (parsed.kind === 'unknown') queen.show({ kind: 'reply', text: unknownLine(p), receipts: [] })
    else if (parsed.kind === 'reply') queen.show({ kind: 'reply', text: parsed.text, receipts: [] })
    else if (parsed.kind === 'ask') queen.show({ kind: 'ask', question: parsed.question })
    else if (parsed.confirm) {
      const types = new Set(parsed.actions.map((a) => a.type))
      const label = types.size === 1 && types.has('close-agents') ? 'Close' : types.size === 1 && types.has('message-agent') ? 'Send' : 'Confirm'
      queen.show({ kind: 'confirm', text: parsed.confirm, label, run: () => execute(parsed.actions, ctx, cards) })
    }
    else await execute(parsed.actions, ctx, cards)
  } catch (error) {
    queen.show({ kind: 'reply', text: failedLine(error instanceof Error ? error.message : String(error), prefs()), receipts: [] })
  } finally {
    useQueen.getState().setBusy(false)
    if (options.spoken) useQueen.setState((s) => (s.card ? { card: { ...s.card, heard: input } } : {}))
    // Talkback: she answers out loud (or, when she stays quiet, a short "done" cue).
    const when = useSettings.getState().settings.queenTalkback
    if (when === 'always' || (when === 'after-voice' && options.spoken)) void speak(cardText())
    else cue('done')
  }
}

/** The user said no to a confirmation. */
export const cancelQueen = (): void => useQueen.getState().show({ kind: 'reply', text: cancelledLine(prefs()), receipts: [] })
