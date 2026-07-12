import { CliConfigAction, McpServerSpec, nectarCommand } from './types.js';

export function antigravityConfig(spec: McpServerSpec): CliConfigAction {
  const command = nectarCommand(spec);

  const pluginManifest = {
    name: 'nectar',
    version: '0.1.0',
    description: 'Nectar cross-agent memory (nectar_query tool)',
  };

  const mcpConfig = {
    mcpServers: {
      nectar: {
        command: command[0],
        args: command.slice(1),
      },
    },
  };

  return {
    kind: 'writePluginDir',
    pluginDir: spec.projectPath + '/.agents/plugins/nectar',
    files: [
      { relativePath: 'plugin.json', content: JSON.stringify(pluginManifest, null, 2) },
      { relativePath: 'mcp_config.json', content: JSON.stringify(mcpConfig, null, 2) },
    ],
    installCommand: {
      command: 'agy',
      args: ['plugin', 'install', spec.projectPath + '/.agents/plugins/nectar'],
    },
  };
}
