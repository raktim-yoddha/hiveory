# Public source and private Dev features

The public repository is the standalone application. Its production build never
requires the private checkout. Chat, Code, manual plugins, Skills, Browser,
Tasks, and the shared application shell remain public. Agent execution is
private; Auto Plugins and premium Themes are private local prototypes.

```text
Hiveory hub/
  hiveory/                 public Git repository
    src/apps/renderer/src/
      app/                 shell, composition, public premium receivers
      features/modes/      Chat and Code
      features/global/     Plugins, Skills, Automations, Browser, Tasks, Settings
      shared/              transport and reusable UI
    src/apps/desktop/       Tauri host and platform adapters
    src/crates/core/        cross-mode contracts, storage, and services
    src/crates/modes/       Chat, Code, and public Agent compatibility crates
      agent/hiveory-agent-runtime/  inert native receiver
  hiveory-private/         separate private Git repository
    src/features/agent/    Agent renderer and execution engine
    src/features/auto-plugins/  local connection-flow prototype
    src/features/themes/   preset and custom-accent UI
```

The public protocol, Agent persistence schema/store, native command adapters,
and Skills policy remain public compatibility contracts. Agent requests in
production return an unavailable response, and the scheduler does not run.
The Agent mode is hidden from production navigation. Production Settings show
the disabled premium option; Chat and Code remain available from first launch.

The Dev edition uses the same shell and host. Vite resolves premium components
to the private sibling checkout. While a Dev process runs, its build script
temporarily points the host and scheduler to the private Agent runtime crate;
the script restores the public Cargo manifests on exit. Dev Agent remains
hidden until enabled in Settings. Dev data and its executable identity are
separate from production, and `releases/dev/` is ignored by Git.

Local commands:

```powershell
pnpm app:build         # production installers and portable
pnpm app:build:dev     # private-feature Dev portable
pnpm app:dev           # live Dev edition
pnpm audit:private-boundary
```

The private checkout is required only for Dev commands. Auto Plugins currently
shows a local preview and does not authorize accounts. Themes persist only in
the local Dev profile. No subscription service, entitlement backend, package
download, or online feature activation exists yet. A future paid release needs
server-verified entitlements and signed packages; the Settings toggles are not
an access-control mechanism.

Existing Git history in the public repository still contains the earlier Agent
implementation. The current tree and future commits remove the execution
engine, but this is not a history rewrite or a revocation of previously
published source. Never stage generated executables or private repository files
in the public repository. Run the private-boundary audit before a public release.
