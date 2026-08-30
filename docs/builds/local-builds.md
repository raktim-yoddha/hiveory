# Local desktop builds

Run this from the repository root:

```powershell
pnpm app:build
```

The command compiles in a temporary directory outside the repository, removes that temporary build output, and refreshes the same three user-facing artifacts in the single canonical output directory:

```text
releases/Hiveory-portable.exe
releases/Hiveory.msi
releases/Hiveory-setup.exe
```

The portable executable runs without an installer. The MSI and setup executable are installer variants for testing installation and upgrade behavior. The `releases/` directory is ignored by Git because these files are generated build output.

Every successful build replaces the existing artifacts and removes any unexpected files or folders from `releases/`. The release build itself retains no Cargo target or installer output inside the project.

Windows does not allow an executable to be replaced while it is running. Close the portable application before rebuilding if the command reports that the portable artifact is in use; the previous files remain available until the next successful publish.
