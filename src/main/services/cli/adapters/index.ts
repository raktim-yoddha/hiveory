import { CATALOG } from './catalog'
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'
import { SHELL_ADAPTERS } from './shells'
import type { CliAdapter } from './types'

/**
 * Supported integrations: plain shells, hook-driven adapters, then the
 * declarative catalog. Adding a CLI means adding an entry — the UI discovers it.
 */
export const BUILT_IN_ADAPTERS: CliAdapter[] = [...SHELL_ADAPTERS, claudeAdapter, codexAdapter, ...CATALOG]

export type { CliAdapter } from './types'
