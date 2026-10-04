import { z } from 'zod'
import { viewportSchema } from '@shared/ipc/contract'
import { DEFAULT_SETTINGS, type AgentPreset, type BrowserProfile, type AppSettings, type CliInstance, type LayoutNode, type Project, type Workspace } from '@shared/domain'

/** Persisted domain configuration only — never processes, PTYs or drag state. */
export interface PersistedState {
  version: 1
  projects: Project[]
  workspaces: Workspace[]
  instances: CliInstance[]
  layouts: Record<string, LayoutNode | null>
  presets: AgentPreset[]
  settings: AppSettings
  browserProfiles: BrowserProfile[]
}

export const emptyState = (): PersistedState => ({
  version: 1,
  projects: [],
  workspaces: [],
  instances: [],
  layouts: {},
  presets: [],
  settings: { ...DEFAULT_SETTINGS },
  browserProfiles: []
})

const settingsSchema = z.object({
  theme: z.enum(['dark', 'bronze', 'silver']).catch(DEFAULT_SETTINGS.theme),
  autoCheckUpdates: z.boolean().catch(DEFAULT_SETTINGS.autoCheckUpdates),
  agentTools: z.boolean().catch(DEFAULT_SETTINGS.agentTools),
  defaultAutoApprove: z.boolean().catch(DEFAULT_SETTINGS.defaultAutoApprove),
  defaultChatUi: z.boolean().catch(DEFAULT_SETTINGS.defaultChatUi),
  browserUse: z.boolean().catch(DEFAULT_SETTINGS.browserUse),
  browserAgentCursor: z.boolean().catch(DEFAULT_SETTINGS.browserAgentCursor),
  browserHomeUrl: z.string().max(2000).catch(DEFAULT_SETTINGS.browserHomeUrl),
  browserDefaultProfile: z.string().max(128).catch(DEFAULT_SETTINGS.browserDefaultProfile),
  browserViewports: z.array(viewportSchema).max(32).catch(DEFAULT_SETTINGS.browserViewports)
})

const browserProfileSchema: z.ZodType<BrowserProfile> = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), name: z.string(), createdAt: z.string() })

const str = z.string()

export const projectSchema: z.ZodType<Project> = z.object({
  id: str,
  name: str,
  path: str,
  repositoryRoot: str.optional(),
  createdAt: str,
  updatedAt: str,
  lastOpenedAt: str
})

export const workspaceSchema: z.ZodType<Workspace> = z.object({
  id: str,
  projectId: str,
  name: str,
  kind: z.enum(['main', 'isolated']),
  path: str,
  git: z
    .object({ worktreePath: str.optional(), branch: str.optional(), baseRef: str.optional(), createdBranch: z.boolean().optional() })
    .optional(),
  association: z.object({ kind: z.enum(['issue', 'pull-request']), ref: str }).optional(),
  autoApprove: z.boolean(),
  chatUi: z.boolean().optional(),
  createdAt: str,
  updatedAt: str
})

export const instanceSchema: z.ZodType<CliInstance> = z.object({
  id: str,
  projectId: str,
  workspaceId: str,
  cliId: str,
  petName: str,
  conversationId: str,
  hasConversation: z.boolean(),
  providerSessionId: str.optional(),
  autoApprove: z.boolean(),
  chatUi: z.boolean().optional(),
  createdAt: str
})

export const layoutSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal('pane'), paneId: str }),
    z
      .object({
        type: z.literal('split'),
        direction: z.enum(['horizontal', 'vertical']),
        children: z.array(layoutSchema).min(2),
        ratios: z.array(z.number().positive().finite())
      })
      // A split whose ratios don't match its children is corrupt; reject it so it gets rebuilt.
      .refine((s) => s.ratios.length === s.children.length)
  ])
)

export const presetSchema: z.ZodType<AgentPreset> = z.object({
  id: str,
  name: str,
  cliSelections: z.array(z.object({ cliId: str, count: z.number().int().positive() })),
  autoApprove: z.boolean(),
  chatUi: z.boolean().optional()
})

/**
 * Parses each record independently so one corrupt entry is dropped instead of
 * discarding everything. Returns how many records were rejected.
 */
export const parseState = (raw: unknown): { state: PersistedState; rejected: number } => {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  let rejected = 0
  const list = <T>(value: unknown, schema: z.ZodType<T>): T[] =>
    (Array.isArray(value) ? value : []).flatMap((item) => {
      const parsed = schema.safeParse(item)
      if (parsed.success) return [parsed.data]
      rejected++
      return []
    })
  const layouts: Record<string, LayoutNode | null> = {}
  const rawLayouts = typeof input.layouts === 'object' && input.layouts !== null ? input.layouts : {}
  for (const [key, value] of Object.entries(rawLayouts)) {
    if (value === null) continue
    const parsed = layoutSchema.safeParse(value)
    if (parsed.success) layouts[key] = parsed.data
    else rejected++
  }
  return {
    state: {
      version: 1,
      projects: list(input.projects, projectSchema),
      workspaces: list(input.workspaces, workspaceSchema),
      instances: list(input.instances, instanceSchema),
      layouts,
      presets: list(input.presets, presetSchema),
      // Unknown or invalid settings fall back to defaults field by field.
      settings: settingsSchema.parse(typeof input.settings === 'object' && input.settings !== null ? input.settings : {}),
      browserProfiles: list(input.browserProfiles, browserProfileSchema)
    },
    rejected
  }
}
