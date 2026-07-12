import { CliConfigAction, McpServerSpec } from './types.js';
import { opencodeConfig } from './opencode.js';
import { claudeCodeConfig } from './claude-code.js';
import { codexConfig } from './codex.js';
import { kiloCodeConfig } from './kilo-code.js';
import { clineConfig } from './cline.js';
import { antigravityConfig } from './antigravity.js';

export * from './types.js';
export { opencodeConfig, claudeCodeConfig, codexConfig, kiloCodeConfig, clineConfig, antigravityConfig };

// One clean map from CLI id -> pure config builder. This replaces the previous
// tangled `if (cli === ...) { ... } else if ...` chain in WorkerBeePane.tsx.
// Adding a CLI = add one file + one entry here.
//
const BUILDERS: Record<string, (spec: McpServerSpec) => CliConfigAction> = {
  opencode: opencodeConfig,
  claude: claudeCodeConfig,
  codex: codexConfig,
  kilo: kiloCodeConfig,
  cline: clineConfig,
  // Antigravity uses a plugin-based MCP path (writePluginDir) rather than a
  // file/command action, so it is NOT added to BUILDERS — its builder is
  // resolved by the special case in buildCliConfig below.
};

/** CLI ids that have a Nectar MCP config builder active by default. */
export const MCP_CAPABLE_CLIS = Object.keys(BUILDERS);

/**
 * CLI ids that have a builder available but gated behind an opt-in flag.
 */
export const EXPERIMENTAL_MCP_CLIS: string[] = [];

export interface BuildCliConfigOptions {
  /**
   * Enable Antigravity's plugin-based MCP path.
   * When true, `agy` returns its plugin `writePluginDir` action instead of a
   * `noop`. Default false -> Antigravity falls back to stdin.
   */
  enableAntigravityPlugin?: boolean;
}

/**
 * Resolve the config action for a CLI. Returns a `noop` action for CLIs with
 * no MCP support (e.g. `kimi`), and — unless explicitly opted in — for
 * Antigravity too, so the host falls back to stdin injection.
 */
export function buildCliConfig(
  cli: string,
  spec: McpServerSpec,
  options: BuildCliConfigOptions = {},
): CliConfigAction {
  // Antigravity: uses a plugin-based MCP path (writePluginDir + agy plugin install)
  // instead of a project config file. Gated behind enableAntigravityPlugin so the
  // host can opt in once it's confirmed the end-to-end tool-call works live.
  if (cli === 'agy') {
    if (options.enableAntigravityPlugin) {
      return antigravityConfig(spec);
    }
    return {
      kind: 'noop',
      reason:
        "Antigravity plugin MCP is gated behind enableAntigravityPlugin; using stdin fallback. " +
        'Set enableAntigravityPlugin: true in ensureMCPConfigForCLI to activate.',
    };
  }

  const builder = BUILDERS[cli];
  if (!builder) {
    return { kind: 'noop', reason: `No MCP support for '${cli}', use stdin fallback` };
  }
  return builder(spec);
}
