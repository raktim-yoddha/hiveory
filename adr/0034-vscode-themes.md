# ADR 0034 — VS Code color themes

Requested by the product owner, 2026-10-08.

## Context

The six built-in themes and the wallpaper transparency stay. Users also want the thousands of
VS Code color themes (Dracula, One Dark Pro, GitHub, Catppuccin…), installed from inside the app
and applied everywhere: every panel, the terminals, the editor and the window chrome.

## Decision

- **Source: Open VSX** (`open-vsx.org`), the open registry of VS Code extensions. The Microsoft
  marketplace is licensed for VS Code products only. Settings › Appearance › VS Code themes lists
  the Themes category by installs, with a search field at the top; Install downloads the `.vsix`.
- **Themes are data, never code.** Main reads `extension/package.json` and each contributed
  `contributes.themes` JSON file (JSONC, `include` chains resolved, `.tmTheme` token files
  skipped). Nothing in the package runs. Icon and product-icon themes are refused with a message.
  The download address comes from Open VSX's own metadata, not the renderer.
- **One mapping, onto our tokens.** `themeTokens` (`src/shared/domain/vscode-theme.ts`) maps a
  theme's `colors` onto Hiveory's design tokens (`--color-bg`, `--base-*`, text, accent, border,
  status, `--term-*`) and its `tokenColors` onto new `--syntax-*` tokens for the editor. Missing
  colors are derived from the editor background and foreground; translucent ones are composited so
  `--base-*` stay opaque. Components never learn about VS Code: the app is themable because every
  color already comes from a token.
- **Stored as tokens.** Only the mapped tokens are kept: one JSON file per extension in
  `userData/themes`. `settings.vscodeTheme` holds the applied theme (`<namespace.name>/<slug>`,
  `''` = the built-in `theme`). Choosing a built-in theme clears it; removing the extension that
  holds it does too.
- **Applied as one stylesheet** on `:root[data-theme][data-custom-theme]`, over the built-in
  theme's tokens, with `color-scheme` set from the theme's kind (light themes get light form
  controls and a lighter `--shadow-tint`). The renderer writes only known token names with hex
  values, so a theme file cannot inject CSS.
- **Transparency stays on top.** VS Code themes set the opaque `--base-*` surfaces like the
  built-in ones, so the wallpaper, transparency, blur and dim apply unchanged.
- **Window chrome** (the native title-bar overlay and window background) follows the theme's
  background and a muted foreground.

## Consequences

- New IPC channels: `themes.search`, `themes.installed`, `themes.install`, `themes.remove`.
  `themes.installed` answers `[]` in a desktop client of a Hiveory server; the others are local.
- The renderer may load extension icons from `open-vsx.org` (CSP `img-src`).
- The phone app keeps its six palettes; VS Code themes are desktop only.
