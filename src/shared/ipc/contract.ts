import { z } from 'zod'
import { SESSION_ID } from '../domain/sessions'
import { EMOJI, HEX_COLOR, MAX_SCRIPT_COMMAND, MAX_SCRIPTS, SCRIPT_NAME, scriptCommandProblem, WORKSPACE_COLORS, WORKSPACE_ICONS } from '../domain/project'
import { DESKTOP_ALERTS, DETACHED_GRACES, FONT_FAMILY, FONT_WEIGHTS, THEME_IDS, TERMINAL_FONT_LIMITS, UPDATE_CHECK_EVERY, UPDATE_REMIND_EVERY } from '../domain/settings'
import type {
  AgentPreset,
  AgentSession,
  AppSettings,
  AnnotationIntent,
  BrowserAnnotation,
  BrowserPageView,
  BrowserProfile,
  BrowserState,
  PickedElement,
  UpdateStatus,
  CliDescriptor,
  CliInstanceView,
  CliRuntimeDetails,
  KanbanBoard,
  LayoutNode,
  Project,
  WorkspaceView,
  HostLinkStatus
} from '../domain'
import type { AgentPeek, AgentUpdate } from '../domain/agent-update'
import type { HiveoryLink } from '../domain/links'
import type { ChatAttachment, ChatCatalog, ChatMessage, ChatSession, ChatSummary, UsageLimits } from '../domain/chat'
import type { ChatAppend } from '../domain/chat-delta'
import type { ChangeSet, CommitSummary } from '../domain/changes'
import type { UsageReport } from '../domain/usage'
import type { TerminalHostStatus } from '../host/protocol'
import { MAX_PROMPT_TITLE, MAX_QUEUED, MAX_SAVED_PROMPT_TEXT, type SavedPrompt } from '../domain/prompt'
import { INTERVAL_MINUTES, MAX_ROUTINE_FILES, MAX_ROUTINE_NAME, MAX_ROUTINE_PROMPT, REPEAT_PRESETS, type RoutineRun, type RoutineView } from '../domain/routine'
import type { ConnectionView, ExtensionsInventory } from '../domain/extensions'
import type { AppAccount, AppsStatus } from '../domain/apps'
import type { EditorView, FileEntry, OpenInApps } from '../domain/files'
import { cleanKeybindings, isAppCommand } from '../keys/keybindings'
import { parseShortcut } from '../keys/shortcut'

/** A wallpaper image the user added; `url` is served by Hiveory's own protocol. */
export interface WallpaperImage {
  file: string
  url: string
  thumb: string
}
import type { GithubIssue, GithubStatus, GitInfo, PullRequest, PullRequestDetail } from '../domain/github'
import { CODE_HOSTS, TRACKERS, type IntegrationsView, type IssueList, type TrackerGroup } from '../domain/integrations'
import type { McpSearchResult, SkillAudit, StoreSkill } from '../domain/stores'
import type { Discovery, ShareStatus, RemotePort, SshHostSuggestion, SshPrompt, TailnetStatus } from '../domain/tailnet'
import { THEME_EXTENSION_ID, THEME_SEGMENT, VSCODE_THEME_ID, type ThemeListing, type VsCodeThemeExtension } from '../domain/vscode-theme'

/**
 * The complete renderer ↔ main contract. Main validates every payload against
 * these schemas; the preload only forwards channels listed here.
 */


const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
/** An SSH alias or user@host: never an ssh option, never shell syntax. */
const sshDestination = z.string().min(1).max(255).regex(/^[A-Za-z0-9_][A-Za-z0-9._-]*(@[A-Za-z0-9_][A-Za-z0-9._-]*)?$/)
const isoDate = z.string().datetime({ offset: true })
/** A routine's editable fields; the service checks the timezone, the cron rule and that a run is left. */
/** A routine runs on a new agent of this CLI in this Worktree (ADR 0040). */
const routineTarget = z.object({ kind: z.literal('workspace'), projectId: id, workspaceId: id, cliId: id })
const routineFields = z.object({
  name: z.string().trim().min(1).max(MAX_ROUTINE_NAME),
  target: routineTarget,
  prompt: z.string().trim().min(1).max(MAX_ROUTINE_PROMPT),
  schedule: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('once') }),
    z.object({ kind: z.literal('interval'), everyMinutes: z.number().int().min(INTERVAL_MINUTES.min).max(INTERVAL_MINUTES.max) }),
    z.object({ kind: z.literal('cron'), expr: z.string().trim().min(1).max(120), preset: z.enum(REPEAT_PRESETS) })
  ]),
  startsAt: isoDate,
  timezone: z.string().min(1).max(64),
  endsAt: isoDate.optional(),
  timeoutMinutes: z.number().int().min(1).max(1440).optional(),
  /** Copies made by `routines.addFile`; main refuses any other path. */
  attachments: z
    .array(z.object({ name: z.string().min(1).max(260), path: z.string().min(1).max(1000), kind: z.enum(['image', 'video', 'text', 'file']), size: z.number().int().min(0) }))
    .max(MAX_ROUTINE_FILES)
    .optional(),
  enabled: z.boolean().optional()
})
const folderPath = z.string().min(1).max(1000)
const projectName = z.string().trim().min(1).max(120)
const side = z.enum(['left', 'right', 'top', 'bottom'])

export const MAX_INSTANCES_PER_CLI = 8

export const viewportSchema = z.object({
  name: z.string().trim().min(1).max(40),
  width: z.number().int().min(200).max(4000),
  height: z.number().int().min(200).max(4000),
  scale: z.number().min(0.5).max(5).optional(),
  mobile: z.boolean().optional()
})

/** '' (none) or an image Hiveory copied into its wallpapers folder. */
export const wallpaperSchema = z.string().regex(/^$|^image:[A-Za-z0-9_-]{1,64}\.(?:jpg|jpeg|png|webp|gif|avif)$/)

const pageId = z.string().regex(/^b\d{1,9}$/)
const skillPath = z.string().min(1).max(1000)
/** The folder files live in: a workspace, or a project when no workspace is open. */
const fileScope = z.object({ workspaceId: id.optional(), projectId: id.optional() }).refine((s) => Boolean(s.workspaceId || s.projectId), 'A worktree or workspace is required.')
const relPath = z.string().max(1000).refine((p) => !p.includes('\0'), 'Invalid path.')
const fileName = z.string().min(1).max(1000)
const changeSource = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('uncommitted') }),
  z.object({ kind: z.literal('branch') }),
  z.object({ kind: z.literal('commit'), sha: z.string().regex(/^[0-9a-f]{7,64}$/) }),
  z.object({ kind: z.literal('turn'), chatId: id, messageId: id })
])
/** `agents` or the id of a CLI that has its own skills folder (checked against the registry's roots in main). */
const skillRoot = id
const connectionId = z.string().regex(/^c[a-z0-9]{1,24}$/)
const appIdSchema = z.string().regex(/^[a-z0-9_]{1,40}$/)
const envName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/)
const headerName = z.string().regex(/^[A-Za-z0-9-]{1,64}$/)
const profileId = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)
const bounds = z.object({
  x: z.number().finite().min(-100000).max(100000),
  y: z.number().finite().min(-100000).max(100000),
  width: z.number().finite().min(0).max(20000),
  height: z.number().finite().min(0).max(20000)
})
const pickedElementSchema = z.object({
  ref: z.string().max(20),
  role: z.string().max(80),
  name: z.string().max(400),
  selector: z.string().max(2000),
  text: z.string().max(2000),
  html: z.string().max(4000)
})

export const cliSelectionSchema = z.object({
  cliId: id,
  count: z.number().int().min(0).max(MAX_INSTANCES_PER_CLI)
})

export const presetInputSchema = z.object({
  id: id.optional(),
  name: z.string().trim().min(1).max(60),
  cliSelections: z.array(cliSelectionSchema).max(32),
  autoApprove: z.boolean()
})

export const layoutOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), paneId: id, targetPaneId: id, side }),
  z.object({ type: z.literal('dock'), paneId: id, side }),
  z.object({ type: z.literal('swap'), paneId: id, targetPaneId: id }),
  z.object({ type: z.literal('arrange'), mode: z.enum(['equal', 'focus', 'columns', 'rows']), focusPaneId: id.optional() }),
  z.object({ type: z.literal('stack'), paneId: id, targetPaneId: id, beforePaneId: id.optional() }),
  z.object({ type: z.literal('activate'), paneId: id }),
  z.object({
    type: z.literal('resize'),
    path: z.array(z.number().int().min(0).max(64)).max(32),
    ratios: z.array(z.number().positive().finite()).min(2).max(64)
  })
])

/** Branch / ref names: Git-safe characters only (main re-validates with git check-ref-format). */
const gitRef = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._/-]+$/)
  .refine((v) => !v.startsWith('-'))

/** A chat CLI's model and effort ('' = the CLI's default); never shell syntax. */
const chatModel = z.string().max(200).regex(/^[\w.:/@[\]-]*$/)
const chatEffort = z.string().max(40).regex(/^[\w-]*$/)

/**
 * A Workspace's own settings (ADR 0037). Sent fields replace the stored ones; null clears a field
 * back to the app's default.
 */
export const projectSettingsPatchSchema = z.object({
  chatDefaults: z.record(id, z.object({ model: chatModel, effort: chatEffort })).nullable().optional(),
  branchPrefix: z.string().max(40).regex(/^([A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]*$/).refine((v) => !v.startsWith('-') && !v.includes('..')).nullable().optional(),
  baseRef: gitRef.nullable().optional(),
  alerts: z.boolean().nullable().optional(),
  pinned: z.boolean().nullable().optional(),
  // ADR 0061: named commands, each name once.
  scripts: z
    .array(z.object({ name: z.string().regex(SCRIPT_NAME), command: z.string().max(MAX_SCRIPT_COMMAND).refine((c) => scriptCommandProblem(c) === null, 'Use one line, without control characters.') }))
    .max(MAX_SCRIPTS)
    .refine((list) => new Set(list.map((s) => s.name.toLowerCase())).size === list.length, 'Each script needs its own name.')
    .nullable()
    .optional(),
  icon: z.enum(WORKSPACE_ICONS).nullable().optional(),
  color: z.enum(WORKSPACE_COLORS).nullable().optional(),
  // ADR 0042: any color; the avatar is set by projects.pickAvatar and can only be cleared here.
  customColor: z.string().regex(HEX_COLOR).nullable().optional(),
  avatar: z.null().optional(),
  emoji: z.string().regex(EMOJI).nullable().optional(),
  // ADR 0040: its code host and where its issues come from.
  codeHost: z.enum([...CODE_HOSTS, 'none']).nullable().optional(),
  issueSource: z.enum([...TRACKERS, 'none']).nullable().optional(),
  trackerGroup: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,19}$/).nullable().optional()
})

export const createWorkspaceSchema = z.object({
  projectId: id,
  /** `main` uses the project folder itself; `isolated` gets a linked worktree + branch. */
  kind: z.enum(['main', 'isolated']).default('isolated'),
  name: z.string().trim().min(1).max(60),
  association: z
    .object({ kind: z.enum(['issue', 'pull-request']), ref: z.string().trim().min(1).max(300) })
    .optional(),
  cliSelections: z.array(cliSelectionSchema).max(32),
  autoApprove: z.boolean(),
  /** Isolated only: base ref for a new branch (default: the repository's default branch). */
  baseRef: gitRef.optional(),
  /** Isolated only: new branch name, or the existing branch when `useExistingBranch`. */
  branch: gitRef.optional(),
  useExistingBranch: z.boolean().optional(),
  /** Isolated only: a remote branch (origin/x) to check out as a local branch following it (ADR 0038). */
  remoteBranch: gitRef.optional()
})

const none = z.undefined()
/** A Tailscale address: 100.64.0.0/10 or fd7a:115c:a1e0::/48. */
const tailnetIp = z
  .string()
  .max(64)
  .regex(/^(100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}|fd7a:115c:a1e0:[0-9a-f:]+)$/i)

export const requestSchemas = {
  'app.info': none,
  // The window's own machine (ADR 0061): a native notification (answers whether it was clicked), the
  // taskbar/dock attention badge, the link that started Hiveory, and the Workspaces its jump list offers.
  'app.notify': z.object({ title: z.string().min(1).max(120), body: z.string().max(300), tag: z.string().max(128).optional() }),
  'app.setAttention': z.object({ waiting: z.number().int().min(0).max(9999) }),
  'app.pendingLink': none,
  'app.setRecent': z.object({ items: z.array(z.object({ projectId: id, name: z.string().min(1).max(120) })).max(10) }),
  /** How many agents need you right now, across every Workspace with alerts on (ADR 0061). */
  'agents.attention': none,
  'projects.list': none,
  'projects.open': none,
  /** Add project (ADR 0020): a folder picked in main, a clone, or a new repository; `name` overrides the folder's name. */
  'projects.add': z.discriminatedUnion('mode', [
    z.object({ mode: z.literal('folder'), path: folderPath, name: projectName.optional() }),
    // A folder on an SSH host (ADR 0022): an absolute POSIX path or ~/…; the host checks it exists.
    z.object({
      mode: z.literal('remote'),
      destination: sshDestination,
      port: z.number().int().min(1).max(65535).optional(),
      path: z.string().trim().min(1).max(1000).regex(/^(\/|~)/),
      name: projectName.optional()
    }),
    z.object({ mode: z.literal('clone'), url: z.string().trim().min(3).max(500), parentDir: folderPath, name: projectName.optional() }),
    z.object({
      mode: z.literal('create'),
      repoName: z.string().trim().regex(/^[A-Za-z0-9._-]{1,100}$/),
      parentDir: folderPath,
      name: projectName.optional(),
      github: z.object({ owner: z.string().regex(/^[A-Za-z0-9-]{1,39}$/), visibility: z.enum(['private', 'public']) }).optional()
    })
  ]),
  /** Shows the folder picker; the chosen folder may then be used by projects.add. */
  'projects.pickFolder': z.object({ purpose: z.enum(['project', 'parent']) }),
  /** Where new repositories and clones go by default, and the GitHub account gh is signed in to. */
  'projects.addDefaults': none,
  'projects.remove': z.object({ projectId: id }),
  'projects.touch': z.object({ projectId: id }),
  /** Rename a Workspace or change its settings (ADR 0037). */
  'projects.update': z.object({ projectId: id, name: projectName.optional(), settings: projectSettingsPatchSchema.optional() }),
  /** Opens an image picker; the chosen image becomes the Workspace's avatar (ADR 0042). Null when cancelled. */
  'projects.pickAvatar': z.object({ projectId: id }),
  /** The avatar of the Workspace's GitHub owner (or the signed-in GitHub account) as its mark (ADR 0043). */
  'projects.githubAvatar': z.object({ projectId: id }),
  'workspaces.list': z.object({ projectId: id }),
  'workspaces.suggestName': z.object({ projectId: id }),
  'workspaces.create': createWorkspaceSchema,
  'workspaces.delete': z.object({ workspaceId: id, force: z.boolean().optional() }),
  // With projectId: the CLIs on that project's machine (an SSH host's own, ADR 0022).
  'clis.list': z.object({ refresh: z.boolean().optional(), projectId: id.optional() }).optional(),
  'agents.list': z.object({ workspaceId: id }),
  'agents.open': z.object({
    workspaceId: id,
    cliId: id,
    /** `asTab`: into the target's area as a tab (tabbed panes, ADR 0042) instead of beside it. */
    placement: z.object({ targetPaneId: id, side, asTab: z.boolean().optional() }).optional(),
    /** Continue this conversation from the CLI's history (Sessions tab) instead of starting a new one. */
    resumeSession: z.string().regex(SESSION_ID).optional(),
    /** Chat view or terminal for this one agent; absent = the Workspace's or Worktree's default (ADR 0037). */
    chatUi: z.boolean().optional()
  }),
  /** The agent CLIs' own conversation history on this computer, for a workspace, a project or everything. */
  'sessions.list': z.object({ scope: z.enum(['workspace', 'project', 'all']), workspaceId: id.optional(), projectId: id.optional() }),
  /** Token use per CLI, model and day over the last `days` days, from the CLIs' own history (ADR 0060). */
  'usage.report': z.object({ days: z.number().int().min(1).max(90) }),
  'agents.close': z.object({ instanceId: id }),
  /** A pane's new name (ADR 0042): letters, digits, spaces and a little punctuation, unique among all agents. */
  'agents.rename': z.object({ instanceId: id, name: z.string().trim().min(1).max(32).regex(/^[\p{L}\p{N} ._'-]+$/u) }),
  'agents.restart': z.object({ instanceId: id }),
  'agents.applyPreset': z.object({ workspaceId: id, presetId: id }),
  'terminal.write': z.object({ instanceId: id, data: z.string().max(1_000_000) }),
  // Floor: some TUIs crash on tiny grids (OpenCode segfaults near 2×1); the renderer never sends less.
  'terminal.resize': z.object({
    instanceId: id,
    cols: z.number().int().min(20).max(1000),
    rows: z.number().int().min(5).max(1000)
  }),
  /**
   * Flow control (ADR 0067): this window drew `chars` more characters of the terminal's output.
   * This computer's own window only: paired devices are never waited for (not a remote channel).
   */
  'terminal.ack': z.object({ instanceId: id, chars: z.number().int().min(1).max(100_000_000) }),
  'terminal.snapshot': z.object({ instanceId: id }),
  'layout.get': z.object({ workspaceId: id }),
  'layout.apply': z.object({ workspaceId: id, operation: layoutOperationSchema }),
  'presets.list': none,
  'presets.save': presetInputSchema,
  'presets.delete': z.object({ presetId: id }),
  'kanban.board': z.object({ projectId: id }),
  /** Types a message into an agent and submits it. */
  'agents.sendMessage': z.object({ instanceId: id, message: z.string().trim().min(1).max(20_000) }),
  /** Stops what an agent is doing without closing it. */
  'agents.interrupt': z.object({ instanceId: id }),
  /** One agent up close: status, activity and the last words on its screen (ADR 0057). */
  'agents.peek': z.object({ instanceId: id }),
  'settings.get': none,
  'settings.update': z
    .object({
      theme: z.enum(THEME_IDS),
      autoCheckUpdates: z.boolean(),
      autoDownloadUpdates: z.boolean(),
      terminalFont: z.object({
        family: z.string().regex(FONT_FAMILY),
        size: z.number().int().min(TERMINAL_FONT_LIMITS.size.min).max(TERMINAL_FONT_LIMITS.size.max),
        lineHeight: z.number().min(TERMINAL_FONT_LIMITS.lineHeight.min).max(TERMINAL_FONT_LIMITS.lineHeight.max),
        weight: z.enum(FONT_WEIGHTS),
        boldWeight: z.enum(FONT_WEIGHTS),
        italic: z.boolean(),
        boldBright: z.boolean()
      }),
      updateCheckEvery: z.enum(UPDATE_CHECK_EVERY),
      updateRemindEvery: z.enum(UPDATE_REMIND_EVERY),
      agentTools: z.boolean(),
      defaultAutoApprove: z.boolean(),
      browserUse: z.boolean(),
      browserAgentCursor: z.boolean(),
      browserHomeUrl: z.string().trim().max(2000),
      browserDefaultProfile: profileId,
      browserViewports: z.array(viewportSchema).max(32),
      computerUse: z.boolean(),
      keepRunningInBackground: z.boolean(),
      desktopAlerts: z.enum(DESKTOP_ALERTS),
      keepAgentsAfterQuit: z.boolean(),
      detachedGrace: z.enum(DETACHED_GRACES),
      keepAwakeForRoutines: z.boolean(),
      shareOnTailnet: z.boolean(),
      shareOnLan: z.boolean(),
      petLink: z.boolean(),
      wallpaper: wallpaperSchema,
      surfaceOpacity: z.number().min(0).max(1),
      wallpaperBlur: z.number().min(0).max(40),
      wallpaperDim: z.number().min(0).max(0.8),
      vscodeTheme: z.union([z.literal(''), z.string().regex(VSCODE_THEME_ID)]),
      keybindings: z
        .record(z.string().max(40), z.string().max(60))
        .refine((r) => Object.keys(r).length <= 40 && Object.entries(r).every(([id, s]) => isAppCommand(id) && (s === '' || parseShortcut(s) !== null)), 'Unknown command or shortcut.')
        .transform(cleanKeybindings)
    })
    .partial(),
  /** Wallpapers the user added (copied into Hiveory's own folder). */
  'wallpapers.list': none,
  /** Opens a file picker; the chosen image is downscaled and copied in. */
  'wallpapers.add': none,
  'wallpapers.remove': z.object({ file: z.string().regex(/^[A-Za-z0-9_-]{1,64}\.(?:jpg|jpeg|png|webp|gif|avif)$/) }),
  /** VS Code color themes (ADR 0034): searched on Open VSX, installed as Hiveory tokens. */
  'themes.search': z.object({ query: z.string().trim().max(100), offset: z.number().int().min(0).max(10_000) }),
  'themes.installed': none,
  'themes.install': z.object({ namespace: z.string().regex(THEME_SEGMENT), name: z.string().regex(THEME_SEGMENT) }),
  'themes.remove': z.object({ id: z.string().regex(THEME_EXTENSION_ID) }),
  /** Settings › Agents › Terminal host (ADR 0050 §11). */
  'terminalHost.status': none,
  'terminalHost.restart': none,
  'updates.status': none,
  'updates.check': none,
  'updates.download': none,
  'updates.install': none,
  /** Reveals a known project/workspace folder in the OS file manager — never an arbitrary path. */
  'system.revealPath': z.object({ projectId: id.optional(), workspaceId: id.optional() }),
  'clipboard.readText': none,
  'clipboard.writeText': z.object({ text: z.string().max(5_000_000) }),
  /** The right-sidebar shell for a Workspace (or a Project's folder). Returns its terminal id. */
  'shell.open': z.object({ workspaceId: id.optional(), projectId: id.optional(), tab: z.string().regex(/^[a-z0-9]{1,12}$/).optional() }),
  'shell.restart': z.object({ id }),
  'shell.close': z.object({ id }),
  'extensions.scan': z.object({ projectId: id.optional() }),
  /** Paths must come from the last scan; main re-validates. */
  'extensions.revealSkill': z.object({ path: skillPath }),
  /** Copies a scanned skill into another skills folder (same scope), so more CLIs load it. */
  'extensions.copySkill': z.object({ path: skillPath, rootId: skillRoot }),
  /** Moves one copy of a scanned skill to the trash. */
  'extensions.removeSkill': z.object({ path: skillPath }),
  'extensions.createSkill': z.object({
    name: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    description: z.string().trim().min(1).max(1024),
    body: z.string().max(100_000),
    rootIds: z.array(skillRoot).min(1).max(40),
    projectId: id.optional()
  }),
  /** Opens a folder picker for a skill folder (with SKILL.md) and copies it into the chosen roots. */
  'extensions.importSkill': z.object({ rootIds: z.array(skillRoot).min(1).max(40), projectId: id.optional() }),
  // Stores (ADR 0041): skills.sh and the official MCP Registry, read from main. A store server is added
  // through connections.saveCustom like any other; a skill is downloaded from its GitHub repository here.
  'store.searchSkills': z.object({ query: z.string().max(200) }),
  'store.topSkills': none,
  'store.skillAudits': z.object({ id: z.string().min(3).max(300) }),
  'store.installSkill': z.object({
    source: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
    skillId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/),
    rootIds: z.array(skillRoot).min(1).max(40),
    projectId: id.optional()
  }),
  'store.searchMcp': z.object({ query: z.string().max(200), cursor: z.string().max(500).optional() }),
  /** MCP servers and apps Hiveory runs for every agent (ADR 0017). Secrets go in, never come back out. */
  /** Explorer (ADR 0018): paths are relative to the scope's folder and re-checked in main. */
  'files.list': z.object({ scope: fileScope, dir: relPath }),
  'files.search': z.object({ scope: fileScope, query: z.string().max(200) }),
  'files.read': z.object({ scope: fileScope, path: fileName }),
  'files.write': z.object({ scope: fileScope, path: fileName, content: z.string().max(10_000_000) }),
  'files.create': z.object({ scope: fileScope, path: fileName, kind: z.enum(['file', 'dir']) }),
  'files.rename': z.object({ scope: fileScope, from: fileName, to: fileName }),
  'files.delete': z.object({ scope: fileScope, paths: z.array(fileName).min(1).max(500) }),
  'files.paste': z.object({ scope: fileScope, sources: z.array(fileName).min(1).max(500), targetDir: relPath, mode: z.enum(['copy', 'move']) }),
  'files.reveal': z.object({ scope: fileScope, path: relPath }),
  /** Watch the folder while its Explorer is open; changes arrive as `files.changed`. */
  'files.watch': z.object({ scope: fileScope, watch: z.boolean() }),
  'editors.list': z.object({ workspaceId: id }),
  'editors.open': z.object({ workspaceId: id, path: fileName, targetPaneId: id.optional(), side: side.optional() }),
  'editors.close': z.object({ editorId: z.string().regex(/^e[a-f0-9]{12}$/) }),
  // ADR 0064: the worktree's review pane (every changed file's diff).
  'editors.openReview': z.object({ workspaceId: id, targetPaneId: id.optional(), side: side.optional() }),
  /** Opens the Composio account page in the system browser (allow-listed in main). */
  'system.openUrl': z.object({ url: z.string().max(500) }),
  // ADR 0064: the top bar's Open in — installed editors, and opening a worktree in one (ids from that list only).
  'system.editorApps': none,
  'system.openIn': z.object({ workspaceId: id, appId: z.string().regex(/^[a-z]{2,20}$/) }),
  'connections.list': none,
  /** Apps (ADR 0023): the user's Composio API key, and app accounts connected through it. */
  'apps.status': none,
  'apps.setKey': z.object({ apiKey: z.string().trim().min(8).max(200).regex(/^\S+$/, 'Paste the key without spaces.') }),
  'apps.removeKey': none,
  /** Every account has a label, so several accounts of one app stay apart. */
  'apps.connect': z.object({ appId: appIdSchema, label: z.string().trim().min(1, 'Name this account.').max(40).regex(/^[\p{L}\p{N} ._-]*$/u, 'Use letters, numbers, spaces, dots, dashes or underscores.') }),
  'apps.disconnect': z.object({ accountId: z.string().regex(/^[A-Za-z0-9_-]{3,64}$/) }),
  'connections.saveCustom': z.object({
    id: connectionId.optional(),
    name: z.string().trim().min(1).max(40),
    transport: z.enum(['stdio', 'http']),
    command: z.string().trim().max(500).optional(),
    args: z.array(z.string().max(2000)).max(64).optional(),
    url: z.string().trim().max(2000).optional(),
    /** An empty value keeps the stored one. */
    env: z.record(envName, z.string().max(8000)),
    headers: z.record(headerName, z.string().max(8000))
  }),
  /** Copies a server found in a CLI's config into Hiveory, so every agent gets it. */
  'connections.import': z.object({ name: z.string().min(1).max(200) }),
  'connections.setEnabled': z.object({ id: connectionId, enabled: z.boolean() }),
  'connections.test': z.object({ id: connectionId }),
  'connections.remove': z.object({ id: connectionId }),
  /** Built-in browser (ADR 0015). Pages live in main; the panel only shows them. */
  'browser.state': none,
  /** `beside`: a worktree's browser pane placed next to another pane (ADR 0042). */
  'browser.open': z.object({
    scope: id,
    url: z.string().max(4000).optional(),
    profileId: profileId.optional(),
    beside: z.object({ paneId: id, side: z.enum(['right', 'bottom', 'tab']) }).optional()
  }),
  'browser.close': z.object({ pageId }),
  /** A URL (normalized in main), or back / forward / reload / stop. */
  'browser.navigate': z.object({ pageId, url: z.string().max(4000) }),
  /** Where the panel shows the page (null parks it); `freeze` returns a picture first, for menus drawn over it. */
  'browser.show': z.object({ pageId, bounds: bounds.nullable(), freeze: z.boolean().optional() }),
  'browser.viewport': z.object({ pageId, viewport: viewportSchema.nullable() }),
  'browser.devtools': z.object({ pageId }),
  'browser.openExternal': z.object({ pageId }),
  'browser.pick': z.object({ pageId }),
  'browser.cancelPick': z.object({ pageId }),
  'browser.annotate': z.object({ pageId, element: pickedElementSchema, note: z.string().trim().min(1).max(4000), intent: z.enum(['change', 'question']).optional() }),
  'browser.deleteAnnotation': z.object({ id: z.string().uuid().optional() }),
  /** The floating note card at the element just picked (ADR 0042): null when skipped. */
  'browser.askNote': z.object({ pageId, label: z.string().max(300), path: z.string().max(1000), intent: z.enum(['change', 'question']) }),
  'browser.updateAnnotation': z.object({ id: z.string().uuid(), note: z.string().trim().min(1).max(4000), intent: z.enum(['change', 'question']) }),
  'browser.switchProfile': z.object({ pageId, profileId }),
  'browser.createProfile': z.object({ name: z.string().trim().min(1).max(40) }),
  'browser.renameProfile': z.object({ profileId, name: z.string().trim().min(1).max(40) }),
  'browser.deleteProfile': z.object({ profileId }),
  'browser.clearData': z.object({ profileId }),
  /** Main shows the file dialog; only the profile crosses the bridge. */
  'browser.importCookies': z.object({ profileId }),
  'browser.exportCookies': z.object({ profileId }),
  'browser.clearCookies': z.object({ profileId }),
  'chat.clis': none,
  'chat.get': z.object({ chatId: id }),
  'chat.update': z.object({
    chatId: id,
    cliId: id.optional(),
    // Model ids like "opencode-go/kimi-k2.7-code" or "sonnet[1m]"; never shell syntax.
    model: z.string().max(200).regex(/^[\w.:/@[\]-]*$/).optional(),
    effort: z.string().max(40).regex(/^[\w-]*$/).optional(),
    autoApprove: z.boolean().optional(),
    title: z.string().max(200).optional(),
    /** Plan and fast mode (ADR 0058). */
    plan: z.boolean().optional(),
    fast: z.boolean().optional()
  }),
  /** Only the model and effort ('' = the CLI's default): what a phone may change on a chat (ADR 0027). */
  'chat.setModel': z.object({ chatId: id, model: chatModel, effort: chatEffort }),
  'chat.send': z.object({
    chatId: id,
    text: z.string().max(100_000),
    attachments: z
      .array(z.object({ name: z.string().min(1).max(260), path: z.string().min(1).max(1000), kind: z.enum(['image', 'video', 'text', 'file']), size: z.number().int().min(0) }))
      .max(20)
      .optional()
  }),
  /** Saves pasted data (screenshot, video, long text) as an attachment file. Base64, at most ~25 MB. */
  'chat.attach': z.object({
    chatId: id,
    name: z.string().min(1).max(200),
    mime: z.string().max(100),
    data: z.string().max(36_000_000)
  }),
  /** Registers a file the user dropped or pasted from disk (by path; nothing is copied). */
  'chat.attachPath': z.object({ chatId: id, path: z.string().min(1).max(1000) }),
  'chat.stop': z.object({ chatId: id }),
  /** Sends, or lines the message up while the chat is answering (ADR 0031). */
  'chat.queue': z.object({ chatId: id, text: z.string().trim().min(1).max(MAX_SAVED_PROMPT_TEXT) }),
  'chat.unqueue': z.object({ chatId: id, index: z.number().int().min(0).max(MAX_QUEUED) }),
  'prompts.list': none,
  'prompts.save': z.object({ id: id.optional(), title: z.string().trim().max(MAX_PROMPT_TITLE).optional(), text: z.string().trim().min(1).max(MAX_SAVED_PROMPT_TEXT) }),
  'prompts.delete': z.object({ promptId: id }),
  'chat.catalog': z.object({ cliId: id, refresh: z.boolean().optional() }),
  /** The CLI's plan limits (5-hour, weekly), as it reports them (ADR 0055). */
  'chat.limits': z.object({ cliId: id, refresh: z.boolean().optional() }),
  /** Undoes one turn's file changes from its checkpoint (ADR 0058). */
  'chat.revertTurn': z.object({ chatId: id, messageId: id }),
  /**
   * Open windows on the computer in front of the user, and a PNG of one (ADR 0058). Always answered by
   * the window's own machine, also as a client of a server; the picture then goes up with `chat.attach`.
   */
  'chat.windows': none,
  'chat.captureWindow': z.object({ sourceId: z.string().min(1).max(200).regex(/^window:[\w:-]+$/) }),
  // A worktree's changes for the side panel's Changes tab (ADR 0058), read from Git where the worktree lives.
  'changes.list': z.object({ workspaceId: id, source: changeSource }),
  'changes.diff': z.object({ workspaceId: id, source: changeSource, path: fileName }),
  'changes.commits': z.object({ workspaceId: id }),
  // The Changes tab's writing actions (ADR 0060): commit everything, push the branch, discard files.
  'changes.commit': z.object({ workspaceId: id, message: z.string().min(1).max(5000) }),
  'changes.push': z.object({ workspaceId: id }),
  'changes.discard': z.object({ workspaceId: id, paths: z.array(fileName.refine((p) => !p.includes('\0'), 'Bad path')).min(1).max(500) }),
  // Routines (ADR 0028, 0040): a Worktree's scheduled work, and the run log.
  'routines.list': none,
  'routines.create': routineFields,
  'routines.update': routineFields.partial().extend({
    routineId: id,
    endsAt: isoDate.nullable().optional(),
    timeoutMinutes: z.number().int().min(1).max(1440).nullable().optional()
  }),
  'routines.delete': z.object({ routineId: id }),
  /** Keeps a copy of a file for a routine's runs; its result goes into the routine's `attachments`. */
  'routines.addFile': z.object({ name: z.string().min(1).max(200), data: z.string().max(36_000_000) }),
  'routines.runNow': z.object({ routineId: id }),
  'routines.runs': z.object({ routineId: id.optional() }),
  /** Checks an SSH host end to end (ADR 0022): probe, install hiveoryd if needed, connect, hello. */
  'hosts.check': z.object({ destination: sshDestination, port: z.number().int().min(1).max(65535).optional() }),
  /** The SSH picker's hosts: Tailscale devices and ~/.ssh/config aliases (ADR 0025). */
  'hosts.suggest': none,
  /** The link to each remote host Hiveory uses, by host key (ADR 0025). */
  'hosts.status': none,
  // Ports listening on a remote project's machine, forwarded to this computer's loopback on request (ADR 0025).
  'ports.list': z.object({ projectId: id }),
  'ports.forward': z.object({ projectId: id, port: z.number().int().min(1).max(65535) }),
  'ports.stop': z.object({ projectId: id, port: z.number().int().min(1).max(65535) }),
  /** Opens a forwarded port in the system browser (only ports Hiveory forwarded). */
  'ports.open': z.object({ projectId: id, port: z.number().int().min(1).max(65535) }),
  /** Questions ssh is still waiting on (for a window that opened after they were asked). */
  'ssh.pending': none,
  /** The window's answer to a question ssh asked (null = cancelled). Never stored on disk. */
  'ssh.answer': z.object({ id: z.string().regex(/^q[a-f0-9]{6}\d{1,9}$/), answer: z.string().max(4096).nullable() }),
  /** Folders on an SSH host, for picking a remote project folder. */
  'hosts.listDir': z.object({
    destination: sshDestination,
    port: z.number().int().min(1).max(65535).optional(),
    path: z.string().max(1000).regex(/^(\/|~|$)/).optional()
  }),
  /** `fetch`: bring origin's branches up to date first (the remote-branch list). */
  'git.info': z.object({ projectId: id, fetch: z.boolean().optional() }),
  'git.validateBranch': z.object({ projectId: id, name: z.string().max(200) }),
  /** Initializes Git in a project folder; `commit` also records an initial commit of its files. */
  'git.init': z.object({ projectId: id, commit: z.boolean() }),
  'workspaces.gitStatus': z.object({ workspaceId: id }),
  'workspaces.repair': z.object({ workspaceId: id }),
  'github.status': z.object({ projectId: id }),
  'github.pullRequests': z.object({ projectId: id }),
  'github.issues': z.object({ projectId: id }),
  'github.createPullRequest': z.object({ workspaceId: id, draft: z.boolean().optional() }),
  // ADR 0064: the open worktree's review with its checks, and Merge.
  'github.pullRequestFor': z.object({ workspaceId: id }),
  'github.merge': z.object({ workspaceId: id, number: z.number().int().positive(), method: z.enum(['squash', 'merge', 'rebase']) }),
  // Code hosts and issue trackers (ADR 0040). The github.* channels above answer for whichever code host
  // the Workspace has (GitHub or GitLab); tracker keys go in here and never come back out.
  'integrations.status': none,
  'integrations.connectJira': z.object({ site: z.string().min(1).max(200), email: z.string().email().max(200), token: z.string().min(1).max(1000) }),
  'integrations.connectLinear': z.object({ apiKey: z.string().min(1).max(1000) }),
  'integrations.disconnect': z.object({ tracker: z.enum(TRACKERS) }),
  'integrations.groups': z.object({ tracker: z.enum(TRACKERS) }),
  'issues.list': z.object({ projectId: id }),
  // Use a Hiveory server from this desktop (ADR 0022): pair once with its code, then the app relaunches as its client.
  'client.status': none,
  'client.connect': z.discriminatedUnion('via', [
    z.object({ via: z.literal('ssh'), destination: sshDestination, port: z.number().int().min(1).max(65535), code: z.string().regex(/^[A-Za-z0-9]{8}$/) }),
    z.object({ via: z.literal('direct'), url: z.string().url().max(300).regex(/^https?:\/\//), code: z.string().regex(/^[A-Za-z0-9]{8}$/) }),
    // A device on the user's tailnet (ADR 0025): no code when it is signed in to the same Tailscale login.
    z.object({
      via: z.literal('tailnet'),
      ip: tailnetIp,
      port: z.number().int().min(1).max(65535),
      name: z.string().min(1).max(100),
      code: z.string().regex(/^[A-Za-z0-9]{8}$/).optional()
    })
  ]),
  'client.disconnect': none,
  /** The user's tailnet devices, marking the ones that run a Hiveory server. */
  'client.discover': none,
  // Share this computer with the user's other devices (ADR 0025); switched on with settings.shareOnTailnet.
  'share.status': none,
  'share.revoke': z.object({ deviceId: z.string().regex(/^[a-f0-9]{12}$/) })
} as const

export interface AppInfo {
  platform: 'win32' | 'darwin' | 'linux'
  version: string
  /** False when the hook server failed to start; status falls back to heuristics. */
  hooksAvailable: boolean
  /** Unpackaged development build (shows the DEV badge). */
  isDev: boolean
  /** This window is a client of a Hiveory server (ADR 0022): everything runs there. */
  client?: { server: string }
}

/** Server/client mode as Settings › Remote shows it. */
export interface ClientStatus {
  mode: 'local' | 'client'
  /** Where the server is (an SSH host and port, or an address). */
  server?: string
  connected: boolean
  detail?: string
}

export interface TerminalSnapshot {
  data: string
  /** Output offset the snapshot ends at; live chunks before it are already included. */
  end: number
  /** The size the program draws for (a phone renders at this size instead of resizing it). */
  cols?: number
  rows?: number
}

export interface DeleteWorkspaceResult {
  /** Set when the local branch was kept because it has unmerged commits. */
  keptBranch?: string
}

export interface ResponseMap {
  'app.info': AppInfo
  'app.notify': { clicked: boolean }
  'app.setAttention': void
  'app.pendingLink': HiveoryLink | null
  'app.setRecent': void
  'agents.attention': { waiting: number }
  'projects.list': Project[]
  'projects.open': Project | null
  'projects.add': Project
  'projects.pickFolder': string | null
  'projects.addDefaults': { parentDir: string; github: { available: boolean; login?: string; owners: string[]; reason?: string } }
  'projects.remove': void
  'projects.touch': Project
  'projects.pickAvatar': Project | null
  'projects.githubAvatar': Project
  'projects.update': Project
  'workspaces.list': WorkspaceView[]
  'workspaces.suggestName': string
  'workspaces.create': WorkspaceView
  'workspaces.delete': DeleteWorkspaceResult
  'clis.list': CliDescriptor[]
  'agents.list': CliInstanceView[]
  /** The new agent plus the resulting layout, so the UI can show the pane without another round trip. */
  'agents.open': { agent: CliInstanceView; layout: LayoutNode | null }
  'agents.close': LayoutNode | null
  'agents.rename': void
  'agents.restart': void
  'agents.applyPreset': void
  'terminal.write': void
  'terminal.resize': void
  'terminal.ack': void
  'terminal.snapshot': TerminalSnapshot
  'layout.get': LayoutNode | null
  'layout.apply': LayoutNode | null
  'presets.list': AgentPreset[]
  'usage.report': UsageReport
  'presets.save': AgentPreset
  'presets.delete': void
  'kanban.board': KanbanBoard
  'sessions.list': AgentSession[]
  'agents.sendMessage': string
  'agents.interrupt': void
  'agents.peek': AgentPeek
  'settings.get': AppSettings
  'settings.update': AppSettings
  'terminalHost.status': TerminalHostStatus
  'terminalHost.restart': TerminalHostStatus
  'updates.status': UpdateStatus
  'updates.check': UpdateStatus
  'updates.download': UpdateStatus
  'updates.install': void
  'system.revealPath': void
  'clipboard.readText': string
  'clipboard.writeText': void
  'shell.open': { id: string; cwd: string }
  'shell.restart': void
  'shell.close': void
  'extensions.scan': ExtensionsInventory
  'extensions.revealSkill': void
  'extensions.copySkill': void
  'extensions.removeSkill': void
  'extensions.createSkill': void
  'extensions.importSkill': boolean
  'store.searchSkills': StoreSkill[]
  'store.topSkills': StoreSkill[]
  'store.skillAudits': SkillAudit[]
  'store.installSkill': void
  'store.searchMcp': McpSearchResult
  'system.openUrl': void
  'system.editorApps': OpenInApps
  'system.openIn': void
  'files.list': { root: string; entries: FileEntry[] }
  'files.search': FileEntry[]
  'files.read': { content: string; size: number }
  'files.write': void
  'files.create': void
  'files.rename': void
  'files.delete': void
  'files.paste': string[]
  'files.reveal': void
  'files.watch': void
  'editors.list': EditorView[]
  'editors.open': EditorView
  'editors.close': void
  'editors.openReview': EditorView
  'connections.list': ConnectionView[]
  'apps.status': AppsStatus
  'apps.setKey': AppsStatus
  'apps.removeKey': void
  'apps.connect': AppAccount
  'apps.disconnect': void
  'connections.saveCustom': ConnectionView
  'connections.import': ConnectionView
  'connections.setEnabled': ConnectionView
  'connections.test': ConnectionView
  'connections.remove': void
  'wallpapers.list': WallpaperImage[]
  'wallpapers.add': WallpaperImage | null
  'wallpapers.remove': void
  'themes.search': { total: number; items: ThemeListing[] }
  'themes.installed': VsCodeThemeExtension[]
  'themes.install': VsCodeThemeExtension
  'themes.remove': void
  'browser.state': BrowserState
  'browser.open': BrowserPageView
  'browser.close': void
  'browser.navigate': void
  'browser.show': string | null
  'browser.viewport': void
  'browser.devtools': void
  'browser.openExternal': void
  'browser.pick': PickedElement | null
  'browser.cancelPick': void
  'browser.annotate': BrowserAnnotation
  'browser.deleteAnnotation': void
  'browser.askNote': { note: string; intent: AnnotationIntent } | null
  'browser.updateAnnotation': void
  'browser.switchProfile': BrowserPageView
  'browser.createProfile': BrowserProfile
  'browser.renameProfile': void
  'browser.deleteProfile': void
  'browser.clearData': void
  'browser.importCookies': { imported: number; failed: number } | null
  'browser.exportCookies': { count: number; path: string } | null
  'browser.clearCookies': { count: number }
  'chat.clis': string[]
  'chat.get': ChatSession & { running: boolean }
  'chat.update': ChatSession
  'chat.setModel': ChatSession
  'chat.send': void
  'chat.attach': ChatAttachment
  'chat.attachPath': ChatAttachment
  'chat.stop': void
  'chat.queue': void
  'chat.unqueue': void
  'prompts.list': SavedPrompt[]
  'prompts.save': SavedPrompt
  'prompts.delete': void
  'chat.catalog': ChatCatalog
  'chat.limits': UsageLimits
  'chat.revertTurn': ChatMessage
  'chat.windows': Array<{ id: string; name: string; thumbnail: string }>
  'chat.captureWindow': { name: string; data: string }
  'changes.list': ChangeSet
  'changes.diff': string
  'changes.commits': CommitSummary[]
  'changes.commit': { sha: string }
  'changes.push': { branch: string; upstream: string }
  'changes.discard': void
  'routines.list': RoutineView[]
  'routines.create': RoutineView
  'routines.update': RoutineView
  'routines.delete': void
  'routines.addFile': ChatAttachment
  'routines.runNow': RoutineRun
  'routines.runs': RoutineRun[]
  'hosts.check': { platform: string; arch: string; node: string; installed: boolean; nodeInstalled: boolean; protocol: number }
  'hosts.suggest': { tailscale: TailnetStatus['state']; hosts: SshHostSuggestion[] }
  'hosts.status': Record<string, HostLinkStatus>
  'ssh.pending': SshPrompt[]
  'ports.list': RemotePort[]
  'ports.forward': { localPort: number }
  'ports.stop': void
  'ports.open': void
  'ssh.answer': void
  'hosts.listDir': { path: string; home: string; dirs: string[] }
  'git.info': GitInfo
  'git.validateBranch': { problem: string | null }
  'git.init': Project
  'workspaces.gitStatus': GitStatusView | null
  'workspaces.repair': WorkspaceView
  'github.status': GithubStatus
  'github.pullRequests': PullRequest[]
  'github.issues': GithubIssue[]
  'github.createPullRequest': { url: string }
  'github.pullRequestFor': PullRequestDetail | null
  'github.merge': void
  'integrations.status': IntegrationsView
  'integrations.connectJira': IntegrationsView
  'integrations.connectLinear': IntegrationsView
  'integrations.disconnect': IntegrationsView
  'integrations.groups': TrackerGroup[]
  'issues.list': IssueList
  'client.status': ClientStatus
  'client.connect': ClientStatus
  'client.disconnect': void
  'client.discover': Discovery
  'share.status': ShareStatus
  'share.revoke': void
}

export interface GitStatusView {
  branch?: string
  upstream?: string
  ahead: number
  behind: number
  changed: number
  untracked: number
}

export type Channel = keyof typeof requestSchemas
export type RequestOf<C extends Channel> = z.input<(typeof requestSchemas)[C]>
export type ResponseOf<C extends Channel> = ResponseMap[C]

export type StateTopic = 'projects' | 'workspaces' | 'agents' | 'presets' | 'layout' | 'settings' | 'chats' | 'connections' | 'editors' | 'routines' | 'prompts' | 'themes'

export interface EventMap {
  'terminal.data': { instanceId: string; data: string; offset: number }
  /** Something changed in a watched folder (scope = workspace or project id). */
  'files.changed': { scope: string; paths: string[] }
  'runtime.changed': { instanceId: string; projectId: string; workspaceId: string; runtime: CliRuntimeDetails }
  /** `chatId`: that chat's settings changed (model, effort, permissions), so open views reload it. */
  'state.changed': { topic: StateTopic; projectId?: string; workspaceId?: string; chatId?: string }
  'app.notice': { level: 'info' | 'warning' | 'error'; message: string }
  'updates.changed': UpdateStatus
  /** Snapshot of the assistant message being streamed (or just finished). */
  'chat.event': { chatId: string; message: ChatMessage; summary: ChatSummary }
  /**
   * Text added to a streaming reply since the last event, for this computer's own window (ADR 0068).
   * Paired clients get `chat.event` instead; everything but added text also comes as `chat.event`.
   */
  'chat.delta': { chatId: string; messageId: string; appends: ChatAppend[] }
  'browser.changed': BrowserState
  /** The link to a remote host changed (ADR 0025). */
  'hosts.changed': { key: string; status: HostLinkStatus }
  /** ssh needs an answer from the user (ADR 0025). */
  'ssh.prompt': SshPrompt
  /** That question was answered (here or in another window) or timed out. */
  'ssh.promptDone': { id: string }
  /** An agent needs you, finished or stopped (ADR 0061): the window may show a desktop notification. */
  'agent.alert': AgentUpdate
  /** How many agents need you now (the taskbar/dock badge). */
  'agents.attention': { waiting: number }
  /** A hiveory:// link was opened (ADR 0061). */
  'app.link': HiveoryLink
}

export type EventName = keyof EventMap

export const CHANNELS = Object.keys(requestSchemas) as Channel[]
/** Every event, checked against EventMap so a new event can't be left out of the preload allow-list. */
const EVENTS: Record<EventName, true> = {
  'terminal.data': true,
  'runtime.changed': true,
  'state.changed': true,
  'app.notice': true,
  'updates.changed': true,
  'chat.event': true,
  'chat.delta': true,
  'browser.changed': true,
  'files.changed': true,
  'hosts.changed': true,
  'ssh.prompt': true,
  'ssh.promptDone': true,
  'agent.alert': true,
  'agents.attention': true,
  'app.link': true
}
export const EVENT_NAMES = Object.keys(EVENTS) as EventName[]

/** Prefix keeping Hiveory IPC channels distinct from anything else on the bus. */
export const IPC_PREFIX = 'hiveory:'
