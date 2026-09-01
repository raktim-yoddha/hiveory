# Local desktop builds

Run this from the repository root:

```powershell
pnpm app:build
```

This creates the production MSI, setup executable, and portable executable in `releases/production/`.

For a portable-only local test build with isolated Hiveory Dev data and a visible `DEV` title-bar label:

```bash
pnpm app:build:dev
```

The Dev executable is written to `releases/dev/Hiveory-Dev-portable.exe` and is ignored by Git.

For live local development, run `pnpm app:dev`; it starts the same isolated Hiveory Dev edition.

The production command compiles in a temporary directory outside the repository, removes that temporary build output, and refreshes these three user-facing artifacts:

```text
releases/production/Hiveory-portable.exe
releases/production/Hiveory.msi
releases/production/Hiveory-setup.exe
```

The portable executable runs without an installer. The MSI and setup executable are installer variants for testing installation and upgrade behavior. The `releases/` directory is ignored by Git because these files are generated build output.

Every successful build replaces its existing canonical artifacts. The release build itself retains no Cargo target or installer output inside the project.

Windows does not allow an executable to be replaced while it is running. Close the portable application before rebuilding if the command reports that the portable artifact is in use; the previous files remain available until the next successful publish.
