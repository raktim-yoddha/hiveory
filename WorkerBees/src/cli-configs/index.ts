import { CliConfigAction, McpServerSpec } from './types.js';
import { opencodeConfig } from './opencode.js';
import { claudeCodeConfig } from './claude-code.js';
import { codexConfig } from './codex.js';
import { kiloCodeConfig } from './kilo-code.js';
import { clineConfig } from './cline.js';
import { antigravityConfig } from './antigravity.js';

export * from './types.js';
export { opencodeConfig, claudeCodeConfig, codexConfig, kiloCodeConfig, clineConfig, antigravityConfig };

const BUILDERS: Record<string, (spec: McpServerSpec) => CliConfigAction> = {
  opencode: opencodeConfig,
  claude: claudeCodeConfig,
  codex: codexConfig,
  kilo: kiloCodeConfig,
  cline: clineConfig,
};

export const MCP_CAPABLE_CLIS = Object.keys(BUILDERS);

export const EXPERIMENTAL_MCP_CLIS: string[] = [];

export interface BuildCliConfigOptions {
  enableAntigravityPlugin?: boolean;
}

export function buildCliConfig(
  cli: string,
  spec: McpServerSpec,
  options: BuildCliConfigOptions = {},
): CliConfigAction {
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
