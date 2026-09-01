# Production and Hiveory Dev Distribution Design

## Goal

Keep production releases and quick local testing builds visibly and operationally separate while sharing the same application code.

Production remains the distributable Hiveory application. Hiveory Dev is a portable-only test edition with the same features, a separate desktop identity and local data directory, and a small `DEV` tag at the right side of the title bar.

## Commands and artifacts

| Command | Edition | Artifacts | Output directory |
| --- | --- | --- | --- |
| `pnpm app:build` | Production Hiveory | MSI, setup executable, portable executable | `releases/production/` |
| `pnpm app:build:dev` | Hiveory Dev | portable executable only | `releases/dev/Hiveory-Dev-portable.exe` |
| `pnpm app:dev` | Hiveory Dev live development | no release artifact | local Tauri development host |

`releases/dev/` is ignored by Git. Production artifacts remain ignored as well. Existing flat `releases/` artifacts are treated as legacy files and are not silently deleted by this change.

## Edition identity

The build scripts create edition-specific temporary Tauri configuration overlays rather than modifying the checked-in production configuration.

Production values remain:

- Product name: `Hiveory`
- Bundle identifier: `com.hiveory.desktop`
- Main binary: `hiveory-desktop`

Hiveory Dev values are:

- Product name: `Hiveory Dev`
- Bundle identifier: `com.hiveory.dev`
- Main binary and portable artifact: `Hiveory-Dev.exe` / `Hiveory-Dev-portable.exe`
- Updater artifacts disabled; Dev never participates in the production updater channel.

The unique identifier gives the two editions distinct platform-managed app-data locations, preventing Dev settings, terminals, browser state, and database contents from affecting production.

## UI behavior

The renderer receives a build-time `VITE_HIVEORY_EDITION` value. It defaults to `production` when absent.

When the value is `dev`, the existing title bar retains the normal Hiveory branding and adds a non-interactive `DEV` label in its right-side action area. No features, workflows, or visual skin beyond this identifier differ from production.

## Release-script behavior

The current release script is split into reusable edition-aware helpers:

- production builds target all Tauri bundle types and publish exactly the three named production artifacts;
- Dev builds target only the application binary and copy it to the Dev portable path;
- each build uses a temporary target directory outside the repository and removes it in `finally`;
- a locked production portable uses the existing versioned fallback behavior, without affecting Dev artifacts;
- Dev artifacts never overwrite production artifacts, and production builds do not delete Dev artifacts.

## Error handling and verification

The scripts fail for compilation, bundling, missing artifact, or non-lock copy errors. A locked production portable is the only recoverable copy case and produces its documented fallback name.

Verification covers:

1. Node syntax checks for both build scripts.
2. Tauri CLI invocation without the Windows shell wrapper.
3. Production build artifact discovery and output names.
4. Dev build output: one portable executable, `Hiveory Dev` product identity, and no installer directories.
5. Renderer production and Dev builds, including a test that the `DEV` label appears only in the Dev edition.
6. Git status confirms Dev release artifacts are ignored.
