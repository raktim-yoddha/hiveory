export interface McpServerSpec {
  mcpServerPath: string;
  projectPath: string;
}

export interface FileConfigAction {
  kind: 'writeFile';
  path: string;
  merge: (existingRaw: string | null) => string;
}

export interface CommandConfigAction {
  kind: 'runCommand';
  command: string;
  args: string[];
}

export interface NoopConfigAction {
  kind: 'noop';
  reason: string;
}

export interface PluginFile {
  relativePath: string;
  content: string;
}

export interface PluginDirConfigAction {
  kind: 'writePluginDir';
  pluginDir: string;
  files: PluginFile[];
  installCommand?: { command: string; args: string[] };
}

export type CliConfigAction =
  | FileConfigAction
  | CommandConfigAction
  | NoopConfigAction
  | PluginDirConfigAction;

export function nectarCommand(spec: McpServerSpec): string[] {
  return ['node', spec.mcpServerPath, '--project', spec.projectPath];
}
