import type { CLISlug } from '@hiveory/worker-bees';

/**
 * A launchable CLI agent id. The catalogue itself (names, commands,
 * descriptions) lives in `@hiveory/worker-bees` — this is only the local alias.
 */
export type CLIType = CLISlug;
