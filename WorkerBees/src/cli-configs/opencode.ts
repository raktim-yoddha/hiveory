import { CliConfigAction, McpServerSpec, nectarCommand } from './types.js';

export function opencodeConfig(spec: McpServerSpec): CliConfigAction {
  const command = nectarCommand(spec);
  const configFile = spec.projectPath + '/opencode.json';

  return {
    kind: 'writeFile',
    path: configFile,
    merge: (existingRaw) => {
      let config: any = {};
      if (existingRaw) {
        try { config = JSON.parse(existingRaw); } catch { config = {}; }
      }
      config.mcp = config.mcp || {};
      config.mcp.nectar = { type: 'local', command, enabled: true };
      if (!config.$schema) config.$schema = 'https://opencode.ai/config.json';
      return JSON.stringify(config, null, 2);
    },
  };
}
