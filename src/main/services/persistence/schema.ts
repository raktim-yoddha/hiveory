import { z } from 'zod'
import type { AgentPreset, CliInstance, LayoutNode, Project, Workspace } from '@shared/domain'

/** Persisted domain configuration only — never processes, PTYs or drag state. */
export interface PersistedState {
  version: 1
  projects: Project[]
  workspaces: Workspace[]
  instances: CliInstance[]
  layouts: Record<string, LayoutNode | null>
  presets: AgentPreset[]
}

export const emptyState = (): PersistedState => ({
  version: 1,
  projects: [],
  workspaces: [],
  instances: [],
  layouts: {},
  presets: []
})

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
  git: z.object({ worktreePath: str.optional(), branch: str.optional(), baseRef: str.optional() }).optional(),
  association: z.object({ kind: z.enum(['issue', 'pull-request']), ref: str }).optional(),
  autoApprove: z.boolean(),
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
  autoApprove: z.boolean(),
  createdAt: str
})

export const layoutSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal('pane'), paneId: str }),
    z.object({
      type: z.literal('split'),
      direction: z.enum(['horizontal', 'vertical']),
      children: z.array(layoutSchema).min(2),
      ratios: z.array(z.number().positive())
    })
  ])
)

export const presetSchema: z.ZodType<AgentPreset> = z.object({
  id: str,
  name: str,
  cliSelections: z.array(z.object({ cliId: str, count: z.number().int().positive() })),
  autoApprove: z.boolean()
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
      presets: list(input.presets, presetSchema)
    },
    rejected
  }
}
