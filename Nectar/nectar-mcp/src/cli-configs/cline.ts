import { CliConfigAction, McpServerSpec, nectarCommand } from './types.js';

// Cline: registered via `cline mcp install`. This is the most fragile of the
// five CLIs and needs a specific workaround (do NOT "simplify" this away):
//
//   Cline's `mcp install` argument parser has a bug where a server command
//   passed after the `--` separator that itself begins with `--` (or contains
//   bare `node <path> --project <path>`) gets mis-tokenised, dropping the
//   `--project` value. The reliable workaround is to hand Cline a `cmd /c`
//   wrapper: we pass `-- cmd /c "<full command string>"` so Cline only ever
//   sees `cmd` as the command and `/c "<...>"` as opaque args, and the real
//   nectar invocation is parsed by cmd.exe instead of Cline's buggy parser.
//
// Any path containing spaces inside the wrapped command is double-quoted so
// cmd.exe re-tokenises it correctly.
export function clineConfig(spec: McpServerSpec): CliConfigAction {
  const command = nectarCommand(spec);
  const quoted = command.map((s) => (s.includes(' ') ? `"${s}"` : s));
  const wrapper = quoted.join(' '); // e.g.  node "C:\...\index.js" --project "C:\...\proj"

  return {
    kind: 'runCommand',
    command: 'cline',
    // The `cmd /c` wrapper is the workaround — see the comment above.
    args: ['mcp', 'install', 'nectar', '--yes', '--', 'cmd', '/c', wrapper],
  };
}
