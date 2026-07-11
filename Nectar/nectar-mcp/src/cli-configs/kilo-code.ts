import { CliConfigAction, McpServerSpec, nectarCommand } from './types.js';

// Kilo Code: uses `kilo.jsonc` with the same `mcp.nectar` shape as OpenCode
// (type "local" + argv command). Written at the project root.
export function kiloCodeConfig(spec: McpServerSpec): CliConfigAction {
  const command = nectarCommand(spec);
  const configFile = spec.projectPath + '/kilo.jsonc';

  return {
    kind: 'writeFile',
    path: configFile,
    merge: (existingRaw) => {
      let config: any = {};
      if (existingRaw) {
        // kilo.jsonc may contain comments; JSON.parse tolerates the common
        // case (no comments). On failure we start fresh rather than corrupt.
        try { config = JSON.parse(existingRaw); } catch { config = {}; }
      }
      config.mcp = config.mcp || {};
      config.mcp.nectar = { type: 'local', command, enabled: true };
      if (!config.$schema) config.$schema = 'https://app.kilo.ai/config.json';
      return JSON.stringify(config, null, 2);
    },
  };
}
