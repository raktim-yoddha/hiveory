import { CliConfigAction, McpServerSpec, nectarCommand } from './types.js';

// Codex CLI: has no project config file for MCP; instead it is registered via
// `codex mcp add <name> -- <command...>`. The `--` separates codex's own flags
// from the server command.
export function codexConfig(spec: McpServerSpec): CliConfigAction {
  const command = nectarCommand(spec);
  return {
    kind: 'runCommand',
    command: 'codex',
    args: ['mcp', 'add', 'nectar', '--', ...command],
  };
}
