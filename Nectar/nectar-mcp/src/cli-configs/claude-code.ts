import { CliConfigAction, McpServerSpec, nectarCommand } from './types.js';

// Claude Code: writes a project-level `.mcp.json` with an `mcpServers.nectar`
// entry. Claude uses the { command, args } shape rather than a single argv.
export function claudeCodeConfig(spec: McpServerSpec): CliConfigAction {
  const command = nectarCommand(spec);
  const configFile = spec.projectPath + '/.mcp.json';

  return {
    kind: 'writeFile',
    path: configFile,
    merge: (existingRaw) => {
      let config: any = {};
      if (existingRaw) {
        try { config = JSON.parse(existingRaw); } catch { config = {}; }
      }
      config.mcpServers = config.mcpServers || {};
      config.mcpServers.nectar = { command: command[0], args: command.slice(1) };
      return JSON.stringify(config, null, 2);
    },
  };
}
