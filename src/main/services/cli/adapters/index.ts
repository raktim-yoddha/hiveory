import { CATALOG } from './catalog'
import { claudeAdapter } from './claude'
import { codexAdapter } from './codex'
import type { CliAdapter } from './types'

/**
 * Supported integrations: hook-driven adapters first, then the declarative
 * catalog. Adding a CLI means adding an entry — the UI discovers it.
 */
export const BUILT_IN_ADAPTERS: CliAdapter[] = [claudeAdapter, codexAdapter, ...CATALOG]

export type { CliAdapter } from './types'
