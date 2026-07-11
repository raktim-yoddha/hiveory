import { CliConfigAction, McpServerSpec } from './types.js';
import { opencodeConfig } from './opencode.js';
import { claudeCodeConfig } from './claude-code.js';
import { codexConfig } from './codex.js';
import { kiloCodeConfig } from './kilo-code.js';
import { clineConfig } from './cline.js';

export * from './types.js';
export { opencodeConfig, claudeCodeConfig, codexConfig, kiloCodeConfig, clineConfig };

// One clean map from CLI id -> pure config builder. This replaces the previous
// tangled `if (cli === ...) { ... } else if ...` chain in WorkerBeePane.tsx.
// Adding a CLI = add one file + one entry here.
const BUILDERS: Record<string, (spec: McpServerSpec) => CliConfigAction> = {
  opencode: opencodeConfig,
  claude: claudeCodeConfig,
  codex: codexConfig,
  kilo: kiloCodeConfig,
  cline: clineConfig,
};

/** CLI ids that have a Nectar MCP config builder. */
export const MCP_CAPABLE_CLIS = Object.keys(BUILDERS);

/**
 * Resolve the config action for a CLI. Returns a `noop` action for CLIs with
 * no MCP support (e.g. `agy`, `kimi`) so the host can fall back to stdin.
 */
export function buildCliConfig(cli: string, spec: McpServerSpec): CliConfigAction {
  const builder = BUILDERS[cli];
  if (!builder) {
    return { kind: 'noop', reason: `No MCP support for '${cli}', use stdin fallback` };
  }
  return builder(spec);
}
