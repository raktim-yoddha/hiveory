// Shared types for per-CLI MCP config builders.
//
// These builders are PURE: they take the resolved paths and return a plain
// description of *what* config to write or *what* command to run. They perform
// no file I/O and import no Tauri APIs, so they can be unit-tested in plain
// Node and reused from any host (the Tauri renderer does the actual I/O via
// its own `invoke()` calls).

export interface McpServerSpec {
  /** Absolute path to the Nectar MCP server entry (index.js). */
  mcpServerPath: string;
  /** Absolute path to the project whose .nectar/ should be queried. */
  projectPath: string;
}

/** A config-file write the host should perform. */
export interface FileConfigAction {
  kind: 'writeFile';
  /** Absolute path of the JSON/JSONC config file to write. */
  path: string;
  /**
   * Existing file content is merged in by the host before writing; the builder
   * returns a `merge(existing)` function so per-CLI merge rules stay local to
   * each CLI file instead of being duplicated in the host.
   */
  merge: (existingRaw: string | null) => string;
}

/** A one-off command the host should run (e.g. `codex mcp add ...`). */
export interface CommandConfigAction {
  kind: 'runCommand';
  command: string;
  args: string[];
}

/** No MCP support for this CLI; host should fall back to stdin injection. */
export interface NoopConfigAction {
  kind: 'noop';
  reason: string;
}

export type CliConfigAction = FileConfigAction | CommandConfigAction | NoopConfigAction;

/** The `node <mcpServerPath> --project <projectPath>` invocation, as argv. */
export function nectarCommand(spec: McpServerSpec): string[] {
  return ['node', spec.mcpServerPath, '--project', spec.projectPath];
}
