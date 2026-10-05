# ADR 0018 — Flat UI, Explorer and Editor Panes, Shell Panes, Composer

Builds on ADR 0017. Supersedes its wallpaper presets and its "raised layers
stay denser" transparency rule.

## Flat, outline-free surfaces
- **No gradients, sheen or textures, in any theme.**
  - Every theme is solid color. The gradient-named tokens
    (`--gradient-metal`, `--gradient-bronze-line`, `--fill-*`) remain, as
    single-color fills, so components need no special cases.
  - `--gradient-app` and `--gradient-surface` are `none`.
  - Resting shadows are gone. Only floating layers (menus, dialogs) keep one.
  - Themes now differ only in color, so the same transparency looks the same
    in each.
- **Outlines mean "selected".**
  - Containers have no resting border: `--color-border-subtle` is
    transparent, and cards and inputs use a transparent border.
  - The border shows on hover, focus or selection. A pane outlines itself
    when it has focus.
  - A pane's header shares the body's surface: no dividing line, no separate
    tint. The same goes for the side panel's header.
- **Transparency is one value for everything.**
  - `--surface-alpha` (0–1) scales every surface alike: panels, raised cards,
    inputs, hover states and pane headers.
  - At full transparency the whole UI floats on the wallpaper. Menus keep
    their glass, and dialogs stay solid for legibility.
- **Wallpapers are the user's.** The built-in gradient wallpapers were
  removed. Only images the user adds are offered, and saved `preset:` values
  fall back to none.

## Pane headers
The ⋯ menu is gone. The pane's name area (logo, name, status) is one button:
- it is the drag grip;
- double-clicking it maximizes the pane;
- right-clicking it (or the context-menu key) opens Restart/Stop, Move and
  Close.

Visible actions are "+", maximize and close.

## Shell panes
- PowerShell (`pwsh`, else Windows PowerShell), Command Prompt and Git Bash are
  CLI adapters with `kind: 'shell'`.
  - Git Bash is located from `git.exe` (`<Git>/bin/bash.exe`).
  - Shells are discovered like any CLI (rule 15) and open as panes with pet
    names and terminals.
- Shells are not agents:
  - they never appear on the Kanban board;
  - they aren't offered in the create-workspace dialog or in Chat;
  - they never detect status (always idle).
- The pane "+" is a popover:
  - Right | Bottom side by side;
  - a search box;
  - **Terminals** first, then **Agents**;
  - full keyboard support (type, ↓, Enter).

## Explorer and editor panes
- **Side panel.** Terminal tabs are removed; terminals are panes now. The side
  panel offers Browser (any number) and **Explorer**, at most one per folder:
  adding it again selects it. The browser rule is unchanged.
- **`FileService` (main).** Every path is relative to the scope's folder (a
  workspace, else the project) and checked to stay inside it. The renderer
  never names a folder.
  - Operations: list, search (path words, skipping `.git`, `node_modules`,
    build output), read (text up to 5 MB; binaries refused), write, create,
    rename, paste (copy or move, with " copy" names), delete (OS trash),
    reveal.
  - A recursive `fs.watch` runs while an Explorer is open. It is debounced and
    sent as `files.changed`.
- **Explorer UI** works like an editor's file tree:
  - lazy folders, search, and inline new file/folder and rename;
  - cut, copy and paste, delete with confirmation, and copy path / relative
    path;
  - keyboard: arrows, Enter, F2, Del, Ctrl+C/X/V;
  - a right-click menu on items and on empty space.
- **Editor panes.**
  - Double-clicking a file opens it as a pane in the workspace layout. It is
    persisted as `editors` (`e<hex>` pane ids) and listed by
    `AgentService.paneIds`, so it splits, drags, swaps and maximizes like an
    agent pane.
  - One pane per file. Renames keep open panes pointing at the file.
  - On a project page, files open in the Main workspace.
  - The editor is **CodeMirror 6**: small, fast on big files, and each
    language loads only when a file needs it.
    - Colors come from the theme's terminal palette.
    - Ctrl+S saves, and a dot marks unsaved changes.
    - When the file changes on disk (an agent edited it) and there are no
      unsaved edits, the pane reloads it.
    - Closing with unsaved changes asks first.

## Chat composer
- **Pattern.** It follows the common professional layout (Claude, Cursor,
  ChatGPT):
  - one quiet card, with the message area on top;
  - a toolbar of **borderless text controls** (model, effort, folder, access)
    that only fill on hover;
  - a compact 28 px square send button, solid accent and flat.
- **What changed.** There are no pills, no outlines at rest and no circles.
  The card outlines on focus.
- **Narrow composers.** Effort and access keep only their icon; the model name
  stays, truncated.

## Icons
No AI-cliché icons (sparkles, lightning, wands, robots). Skills use a scroll icon;
"Add to every agent" uses a plus. "Agent" uses Hiveory's own `AgentIcon` (a hive
cell holding a terminal prompt, drawn on lucide's grid), matching the bee brand.
Codex is identified by its own blue cloud mark (LobeHub `codex-color`, app tile
removed), not the OpenAI logo.

## Selection and dropdowns
- Selected chips, option cards and "on" badges are a tinted fill
  (`--fill-accent-soft`) with accent text, never a silver or bronze outline.
- The shared `Select` is a themed listbox; native `<select>` is not used, because
  its OS-drawn popup ignores the theme. Floating layers opened inside a modal
  `<dialog>` portal into it (outside it everything is inert), and the browser page
  steps aside for listboxes and popovers as it does for menus.

## Pane header and chat
- Plus, maximize and close always show, at any pane width; only the status
  detail drops and the name truncates.
- Chat replies carry no CLI avatar: the pane or chat header already names the CLI.

## Security tightening
- All web contents: no `<webview>`, popups denied by default.
- Window: permission checks denied as well as requests. (Browser pages keep default
  checks: denying them broke agent snapshots and drag-and-drop.)
- Browser pages: links and redirects limited to http(s), file and about:blank.
- CSP adds `object-src`/`frame-src`/`base-uri`/`form-action 'none'`; builds drop the
  dev-only `ws://localhost`.
- Explorer and editor refuse `.git` paths (a written hook would run on the next
  commit) and symlinks or junctions that resolve outside the folder.

## Consequences
- The side panel no longer owns shells. `run_in_terminal` (agent tools) still
  uses the workspace's background shell.
- Editor panes count as panes but not as agents. A workspace with only open
  files is not "empty", and presets still require no agents.
