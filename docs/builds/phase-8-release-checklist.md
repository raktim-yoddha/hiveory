# Phase 8 release checklist

This checklist is the operational definition of the `1.0.0` desktop release. The reference checkouts under `techn/` remain read-only behavioral references; they are not bundled, imported, or launched.

## Local verification

```bash
pnpm install
pnpm app:doctor
pnpm verify
pnpm app:dev
pnpm app:build
```

Smoke-test all three modes in the native window:

- Agent: create or select an agent, grant a folder explicitly, run a prompt, inspect events/artifacts, and verify an approval pause can resume.
- Code: open a repository, leave it untrusted until the trust action, inspect the file tree/editor, start a terminal or coding-agent adapter, review Git status/diff, and use the preview boundary.
- Chat: create a conversation without a mounted workspace, attach a supported file, stream a turn, stop/retry/branch it, and export the selected branch.
- Shared shell: switch modes while work is active, open the command palette with `Ctrl/Cmd+K`, open notifications, change scale/density/reduced motion, close and reopen, and confirm active mode/window geometry are restored.

## Recovery and data

- Trigger a diagnostic notification and confirm it is retained in the notification center.
- Run the restart-recovery action and verify the UI reports the recovery state instead of claiming success.
- Create a backup from Settings, inspect that it is a ZIP with `manifest.json`, `database.sqlite3`, and only `artifacts/` payloads, then restore it through the explicit restart flow.
- Verify provider keys remain absent from SQLite, event payloads, backup manifests, and renderer state.
- Exercise a provider failure, a cancelled stream, an interrupted terminal, and an interrupted orchestration dispatch. Each must retain a stable state and redacted error.

## Update channel

Runtime update checks are intentionally disabled until both variables are set:

```text
HIVEORY_UPDATER_ENDPOINT=https://updates.example.invalid/{{target}}/{{current_version}}
HIVEORY_UPDATER_PUBKEY=<minisign-public-key>
```

Publishing also requires the Tauri signing private key in the build environment. Do not commit keys, endpoint credentials, or generated signing material. Test one update against each target platform before enabling the channel for users.

## Cross-platform gate

Run the native smoke flow on Windows, macOS, and Linux. Confirm the following platform-specific boundaries:

- OS credential storage accepts and retrieves a provider secret.
- PTY/ConPTY sessions start, resize, stream bounded output, and stop cleanly.
- The system WebView renders Agent, Code, Chat, the command palette, settings, and preview isolation without horizontal overflow.
- Native notification permission and delivery follow the platform policy.
- The generated package starts without a Node.js, Python, or Electron runtime.

## Defect gate

Do not publish with an unresolved critical/high security issue, an unbounded process or path capability, a missing migration test, a failing identity/reference scan, a provider secret in logs, or an operation reported as successful after an ambiguous interruption.
