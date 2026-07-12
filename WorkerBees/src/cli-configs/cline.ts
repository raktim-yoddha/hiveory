import { CliConfigAction, McpServerSpec, nectarCommand } from './types.js';

export function clineConfig(spec: McpServerSpec): CliConfigAction {
  const command = nectarCommand(spec);
  const quoted = command.map((s) => (s.includes(' ') ? `"${s}"` : s));
  const wrapper = quoted.join(' ');

  return {
    kind: 'runCommand',
    command: 'cline',
    args: ['mcp', 'install', 'nectar', '--yes', '--', 'cmd', '/c', wrapper],
  };
}
