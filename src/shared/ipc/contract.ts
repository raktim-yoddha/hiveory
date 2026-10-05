import { z } from 'zod'
import type {
  AgentPreset,
  AppSettings,
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
  WorkspaceView
} from '../domain'
import type { ChatAttachment, ChatCatalog, ChatMessage, ChatSession, ChatSummary } from '../domain/chat'
import type { ConnectionRequirements, ConnectionView, ExtensionsInventory } from '../domain/extensions'
import type { EditorView, FileEntry } from '../domain/files'
import type { BrainAccountView, BrainResult } from '../queen/brain'
import { KOKORO_VOICES, type VoicePackState } from '../queen/voice'
import { parseShortcut, type HotkeySignal, type HotkeyStatus } from '../queen/shortcut'
import { MAX_NOTE_LENGTH, MAX_NOTES } from '../queen/actions'
import { customNameProblem } from '../queen/personas'

/** A wallpaper image the user added; `url` is served by Hiveory's own protocol. */
export interface WallpaperImage {
  file: string
  url: string
  thumb: string
}
import type { GithubIssue, GithubStatus, GitInfo, PullRequest } from '../domain/github'

/**
 * The complete renderer ↔ main contract. Main validates every payload against
 * these schemas; the preload only forwards channels listed here.
 */


/** What Queen Bee sends a model: names and ids only, bounded. */
const shortText = z.string().max(200)
const queenContextSchema = z.object({
  mode: z.enum(['workspace', 'chatspace']),
  projectId: shortText.optional(),
  workspaceId: shortText.optional(),
  projects: z.array(z.object({ id: shortText, name: shortText })).max(500),
  workspaces: z.array(z.object({ id: shortText, name: shortText, kind: z.enum(['main', 'isolated']) })).max(500),
  agents: z
    .array(z.object({ id: shortText, petName: shortText, cliId: shortText, workspaceId: shortText, status: z.enum(['idle', 'working', 'waiting-for-you']).optional() }))
    .max(500),
  clis: z.array(z.object({ id: shortText, displayName: shortText })).max(200),
  presets: z.array(z.object({ id: shortText, name: shortText })).max(200)
})

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/)
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
const fileScope = z.object({ workspaceId: id.optional(), projectId: id.optional() }).refine((s) => Boolean(s.workspaceId || s.projectId), 'A workspace or project is required.')
const relPath = z.string().max(1000).refine((p) => !p.includes('\0'), 'Invalid path.')
const fileName = z.string().min(1).max(1000)
const skillRoot = z.enum(['agents', 'claude', 'codex', 'cursor'])
const connectionId = z.string().regex(/^c[a-z0-9]{1,24}$/)
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
  autoApprove: z.boolean(),
  chatUi: z.boolean().optional()
})

export const layoutOperationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('move'), paneId: id, targetPaneId: id, side }),
  z.object({ type: z.literal('dock'), paneId: id, side }),
  z.object({ type: z.literal('swap'), paneId: id, targetPaneId: id }),
  z.object({ type: z.literal('arrange'), mode: z.enum(['equal', 'focus', 'columns']), focusPaneId: id.optional() }),
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
  chatUi: z.boolean().optional(),
  /** Isolated only: base ref for a new branch (default: the repository's default branch). */
  baseRef: gitRef.optional(),
  /** Isolated only: new branch name, or the existing branch when `useExistingBranch`. */
  branch: gitRef.optional(),
  useExistingBranch: z.boolean().optional()
})

const none = z.undefined()

export const requestSchemas = {
  'app.info': none,
  'projects.list': none,
  'projects.open': none,
  'projects.remove': z.object({ projectId: id }),
  'projects.touch': z.object({ projectId: id }),
  'workspaces.list': z.object({ projectId: id }),
  'workspaces.suggestName': z.object({ projectId: id }),
  'workspaces.create': createWorkspaceSchema,
  'workspaces.delete': z.object({ workspaceId: id, force: z.boolean().optional() }),
  'clis.list': z.object({ refresh: z.boolean().optional() }).optional(),
  'agents.list': z.object({ workspaceId: id }),
  'agents.open': z.object({
    workspaceId: id,
    cliId: id,
    placement: z.object({ targetPaneId: id, side }).optional()
  }),
  'agents.close': z.object({ instanceId: id }),
  'agents.restart': z.object({ instanceId: id }),
  'agents.applyPreset': z.object({ workspaceId: id, presetId: id }),
  'terminal.write': z.object({ instanceId: id, data: z.string().max(1_000_000) }),
  'terminal.resize': z.object({
    instanceId: id,
    cols: z.number().int().min(2).max(1000),
    rows: z.number().int().min(2).max(1000)
  }),
  'terminal.snapshot': z.object({ instanceId: id }),
  'layout.get': z.object({ workspaceId: id }),
  'layout.apply': z.object({ workspaceId: id, operation: layoutOperationSchema }),
  'presets.list': none,
  'presets.save': presetInputSchema,
  'presets.delete': z.object({ presetId: id }),
  'kanban.board': z.object({ projectId: id }),
  /** Types a message into an agent and submits it (Queen Bee's "tell Bruno to …"). */
  'agents.sendMessage': z.object({ instanceId: id, message: z.string().trim().min(1).max(20_000) }),
  /** Queen Bee's model (ADR 0019). The key is write-only: never read back. */
  'queen.accounts': none,
  'queen.saveAccount': z.object({
    id: z.string().regex(/^q[a-f0-9]{12}$/).optional(),
    provider: z.string().regex(/^[a-z]{1,40}$/),
    label: z.string().trim().max(40),
    kind: z.enum(['openai', 'anthropic', 'gemini', 'codex', 'claude-code']).optional(),
    baseUrl: z.string().trim().max(500),
    model: z.string().trim().max(200),
    apiKey: z.string().max(500).nullable().optional(),
    enabled: z.boolean().optional()
  }),
  'queen.removeAccount': z.object({ id: z.string().regex(/^q[a-f0-9]{12}$/) }),
  'queen.moveAccount': z.object({ id: z.string().regex(/^q[a-f0-9]{12}$/), to: z.number().int().min(0).max(50) }),
  'queen.testAccount': z.object({ id: z.string().regex(/^q[a-f0-9]{12}$/) }),
  /** The provider's model list, with the key typed in the form or the saved key of `id`. */
  'queen.listModels': z.object({
    id: z.string().regex(/^q[a-f0-9]{12}$/).optional(),
    provider: z.string().regex(/^[a-z]{1,40}$/),
    kind: z.enum(['openai', 'anthropic', 'gemini', 'codex', 'claude-code']).optional(),
    baseUrl: z.string().trim().max(500),
    apiKey: z.string().max(500).optional()
  }),
  /** Local speech (ADR 0019 phase 3): packs download only on request. */
  'voice.status': none,
  'voice.download': z.object({ pack: z.enum(['parakeet', 'whisper', 'kokoro']) }),
  'voice.cancel': z.object({ pack: z.enum(['parakeet', 'whisper', 'kokoro']) }),
  'voice.remove': z.object({ pack: z.enum(['parakeet', 'whisper', 'kokoro']) }),
  /** 16 kHz mono push-to-talk audio, at most 60 s. */
  'voice.transcribe': z.object({ samples: z.instanceof(Float32Array).refine((a) => a.length > 0 && a.length <= 16000 * 60, 'Clip too long.'), language: z.enum(['en', 'es', 'pt', 'de', 'fr', 'hi']) }),
  'voice.speak': z.object({ text: z.string().trim().min(1).max(600) }),
  /** macOS asks for the microphone once; Windows reports its privacy setting. */
  'voice.micAccess': none,
  'queen.plan': z.object({ utterance: z.string().trim().min(1).max(2000), context: queenContextSchema }),
  /** The system-wide shortcut's native hook (opt-in): running, off, or why not. */
  'queen.hotkeyStatus': none,
  /** macOS: asks for Accessibility access, then starts the hook if allowed. */
  'queen.hotkeyAccess': none,
  'settings.get': none,
  'settings.update': z
    .object({
      theme: z.enum(['dark', 'bronze', 'silver', 'midnight', 'jade', 'rose']),
      autoCheckUpdates: z.boolean(),
      agentTools: z.boolean(),
      defaultAutoApprove: z.boolean(),
      defaultChatUi: z.boolean(),
      browserUse: z.boolean(),
      browserAgentCursor: z.boolean(),
      browserHomeUrl: z.string().trim().max(2000),
      browserDefaultProfile: profileId,
      browserViewports: z.array(viewportSchema).max(32),
      computerUse: z.boolean(),
      wallpaper: wallpaperSchema,
      surfaceOpacity: z.number().min(0).max(1),
      wallpaperBlur: z.number().min(0).max(40),
      wallpaperDim: z.number().min(0).max(0.8),
      queenPersona: z.enum(['ada', 'sunny', 'frankie', 'custom']),
      queenCustomName: z.string().trim().max(20).refine((s) => customNameProblem(s) === null, 'Pick another name.'),
      queenCustomPersona: z.string().max(500),
      queenCustomFormal: z.number().int().min(0).max(100),
      queenCustomEnergy: z.number().int().min(0).max(100),
      queenCustomDirect: z.number().int().min(0).max(100),
      queenCallMeSay: z.string().trim().max(60),
      queenGoal: z.string().trim().max(200),
      queenIntensity: z.enum(['steady', 'hard']),
      queenMemory: z.array(z.string().trim().min(1).max(MAX_NOTE_LENGTH)).max(MAX_NOTES),
      queenGlobalShortcut: z.boolean(),
      queenVoice: z.number().int().min(-1).max(KOKORO_VOICES.length - 1),
      queenCallMe: z.string().trim().max(40),
      queenHonorific: z.enum(['sir', 'maam', 'name', 'none']),
      queenHype: z.enum(['calm', 'lively', 'max']),
      queenNudgeMinutes: z.number().int().min(0).max(240),
      queenLength: z.enum(['short', 'normal']),
      queenShortcut: z.string().max(60).refine((s) => parseShortcut(s) !== null, 'Use two or three keys, at least one of them a modifier.'),
      queenSpeechLanguage: z.enum(['en', 'es', 'pt', 'de', 'fr', 'hi']),
      queenSpeak: z.enum(['after-voice', 'always', 'never']),
      queenVoiceSpeed: z.number().min(0.8).max(1.4)
    })
    .partial(),
  /** Wallpapers the user added (copied into Hiveory's own folder). */
  'wallpapers.list': none,
  /** Opens a file picker; the chosen image is downscaled and copied in. */
  'wallpapers.add': none,
  'wallpapers.remove': z.object({ file: z.string().regex(/^[A-Za-z0-9_-]{1,64}\.(?:jpg|jpeg|png|webp|gif|avif)$/) }),
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
    rootIds: z.array(skillRoot).min(1).max(4),
    projectId: id.optional()
  }),
  /** Opens a folder picker for a skill folder (with SKILL.md) and copies it into the chosen roots. */
  'extensions.importSkill': z.object({ rootIds: z.array(skillRoot).min(1).max(4), projectId: id.optional() }),
  /** MCP servers and plugins Hiveory runs for every agent (ADR 0017). Secrets go in, never come back out. */
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
  /** Opens a plugin's "create a key" page or a runner's install page in the system browser (allow-listed in main). */
  'system.openUrl': z.object({ url: z.string().max(500) }),
  'connections.list': none,
  'connections.requirements': none,
  /** Sets up a plugin account: `id` edits one, no `id` adds another (each with its own `label`). */
  'connections.savePlugin': z.object({
    pluginId: z.string().regex(/^[a-z0-9]{1,32}$/),
    values: z.record(z.string().regex(/^\w{1,32}$/), z.string().max(4000)),
    id: connectionId.optional(),
    label: z.string().trim().max(40).regex(/^[\p{L}\p{N} ._-]*$/u, 'Use letters, numbers, spaces, dots, dashes or underscores.').optional()
  }),
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
  'browser.open': z.object({ scope: id, url: z.string().max(4000).optional(), profileId: profileId.optional() }),
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
  'browser.annotate': z.object({ pageId, element: pickedElementSchema, note: z.string().trim().min(1).max(4000) }),
  'browser.deleteAnnotation': z.object({ id: z.string().uuid().optional() }),
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
  'chat.list': none,
  'chat.get': z.object({ chatId: id }),
  'chat.create': z.object({ projectId: id.optional() }),
  'chat.update': z.object({
    chatId: id,
    cliId: id.optional(),
    projectId: z.union([id, z.literal('')]).optional(),
    // Model ids like "opencode-go/kimi-k2.7-code" or "sonnet[1m]"; never shell syntax.
    model: z.string().max(200).regex(/^[\w.:/@[\]-]*$/).optional(),
    effort: z.string().max(40).regex(/^[\w-]*$/).optional(),
    autoApprove: z.boolean().optional(),
    title: z.string().max(200).optional()
  }),
  'chat.delete': z.object({ chatId: id }),
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
  'chat.catalog': z.object({ cliId: id, refresh: z.boolean().optional() }),
  'git.info': z.object({ projectId: id }),
  'git.validateBranch': z.object({ projectId: id, name: z.string().max(200) }),
  /** Initializes Git in a project folder; `commit` also records an initial commit of its files. */
  'git.init': z.object({ projectId: id, commit: z.boolean() }),
  'workspaces.gitStatus': z.object({ workspaceId: id }),
  'workspaces.repair': z.object({ workspaceId: id }),
  'github.status': z.object({ projectId: id }),
  'github.pullRequests': z.object({ projectId: id }),
  'github.issues': z.object({ projectId: id }),
  'github.createPullRequest': z.object({ workspaceId: id, draft: z.boolean().optional() })
} as const

export interface AppInfo {
  platform: 'win32' | 'darwin' | 'linux'
  version: string
  /** False when the hook server failed to start; status falls back to heuristics. */
  hooksAvailable: boolean
  /** Unpackaged development build (shows the DEV badge). */
  isDev: boolean
}

export interface TerminalSnapshot {
  data: string
  /** Output offset the snapshot ends at; live chunks before it are already included. */
  end: number
}

export interface DeleteWorkspaceResult {
  /** Set when the local branch was kept because it has unmerged commits. */
  keptBranch?: string
}

export interface ResponseMap {
  'app.info': AppInfo
  'projects.list': Project[]
  'projects.open': Project | null
  'projects.remove': void
  'projects.touch': Project
  'workspaces.list': WorkspaceView[]
  'workspaces.suggestName': string
  'workspaces.create': WorkspaceView
  'workspaces.delete': DeleteWorkspaceResult
  'clis.list': CliDescriptor[]
  'agents.list': CliInstanceView[]
  /** The new agent plus the resulting layout, so the UI can show the pane without another round trip. */
  'agents.open': { agent: CliInstanceView; layout: LayoutNode | null }
  'agents.close': LayoutNode | null
  'agents.restart': void
  'agents.applyPreset': void
  'terminal.write': void
  'terminal.resize': void
  'terminal.snapshot': TerminalSnapshot
  'layout.get': LayoutNode | null
  'layout.apply': LayoutNode | null
  'presets.list': AgentPreset[]
  'presets.save': AgentPreset
  'presets.delete': void
  'kanban.board': KanbanBoard
  'agents.sendMessage': string
  'queen.accounts': BrainAccountView[]
  'queen.saveAccount': BrainAccountView[]
  'queen.removeAccount': BrainAccountView[]
  'queen.moveAccount': BrainAccountView[]
  'queen.testAccount': { ms: number; detail: string }
  'queen.listModels': string[]
  'voice.status': VoicePackState[]
  'voice.download': void
  'voice.cancel': void
  'voice.remove': void
  'voice.transcribe': { text: string; ms: number }
  'voice.speak': { samples: Float32Array; sampleRate: number }
  'voice.micAccess': boolean
  'queen.plan': BrainResult
  'queen.hotkeyStatus': HotkeyStatus
  'queen.hotkeyAccess': HotkeyStatus
  'settings.get': AppSettings
  'settings.update': AppSettings
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
  'system.openUrl': void
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
  'connections.list': ConnectionView[]
  'connections.requirements': ConnectionRequirements
  'connections.savePlugin': ConnectionView
  'connections.saveCustom': ConnectionView
  'connections.import': ConnectionView
  'connections.setEnabled': ConnectionView
  'connections.test': ConnectionView
  'connections.remove': void
  'wallpapers.list': WallpaperImage[]
  'wallpapers.add': WallpaperImage | null
  'wallpapers.remove': void
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
  'browser.switchProfile': BrowserPageView
  'browser.createProfile': BrowserProfile
  'browser.renameProfile': void
  'browser.deleteProfile': void
  'browser.clearData': void
  'browser.importCookies': { imported: number; failed: number } | null
  'browser.exportCookies': { count: number; path: string } | null
  'browser.clearCookies': { count: number }
  'chat.clis': string[]
  'chat.list': ChatSummary[]
  'chat.get': ChatSession & { running: boolean }
  'chat.create': ChatSession
  'chat.update': ChatSession
  'chat.delete': void
  'chat.send': void
  'chat.attach': ChatAttachment
  'chat.attachPath': ChatAttachment
  'chat.stop': void
  'chat.catalog': ChatCatalog
  'git.info': GitInfo
  'git.validateBranch': { problem: string | null }
  'git.init': Project
  'workspaces.gitStatus': GitStatusView | null
  'workspaces.repair': WorkspaceView
  'github.status': GithubStatus
  'github.pullRequests': PullRequest[]
  'github.issues': GithubIssue[]
  'github.createPullRequest': { url: string }
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

export type StateTopic = 'projects' | 'workspaces' | 'agents' | 'presets' | 'layout' | 'settings' | 'chats' | 'connections' | 'editors'

export interface EventMap {
  'terminal.data': { instanceId: string; data: string; offset: number }
  /** Something changed in a watched folder (scope = workspace or project id). */
  'files.changed': { scope: string; paths: string[] }
  'voice.changed': VoicePackState[]
  /** Queen Bee's shortcut was used while another app was focused. */
  'queen.hotkey': { signal: HotkeySignal }
  'runtime.changed': { instanceId: string; projectId: string; workspaceId: string; runtime: CliRuntimeDetails }
  'state.changed': { topic: StateTopic; projectId?: string; workspaceId?: string }
  'app.notice': { level: 'info' | 'warning' | 'error'; message: string }
  'updates.changed': UpdateStatus
  /** Snapshot of the assistant message being streamed (or just finished). */
  'chat.event': { chatId: string; message: ChatMessage; summary: ChatSummary }
  'browser.changed': BrowserState
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
  'browser.changed': true,
  'files.changed': true,
  'voice.changed': true,
  'queen.hotkey': true
}
export const EVENT_NAMES = Object.keys(EVENTS) as EventName[]

/** Prefix keeping Hiveory IPC channels distinct from anything else on the bus. */
export const IPC_PREFIX = 'hiveory:'
