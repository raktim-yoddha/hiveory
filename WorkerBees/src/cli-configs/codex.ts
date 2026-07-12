import { CliConfigAction, McpServerSpec, nectarCommand } from './types.js';

export function codexConfig(spec: McpServerSpec): CliConfigAction {
  const command = nectarCommand(spec);
  return {
    kind: 'runCommand',
    command: 'codex',
    args: ['mcp', 'add', 'nectar', '--', ...command],
  };
}
