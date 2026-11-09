# ADR 0065 — UI polish: brand and file-type icons, no Settings Guide

Builds on ADR 0042, 0044, 0062 and 0064; supersedes ADR 0044's Settings › Guide.
Decided by the product owner, 2026-11-10.

## Context

After several rounds of new screens the product owner asked for a full UI and UX pass in the app's
own design language: find what looked sloppy, cramped or inconsistent and fix it, give the Open in
menu real icons, and remove the Guide page from Settings. A screenshot of every screen found:
generic icons for editors and files, panes and the side panel breaking at their narrowest widths,
Schedules floating on the bare window, raw CLI error text, repeated labels and outdated copy.

## Decision

- **Settings › Guide is gone** (and its Find entry). Agents still get the app guide through
  `hiveory_about` (`APP_GUIDE`, ADR 0041), which keeps its rule for new screens.
- **Brand marks.** Open in shows each editor's own mark and this system's file manager by its name
  and mark (File Explorer, Finder or Files). The marks come from main with the editor list
  (`EditorApp.icon`, `OpenInApps`), as CLI logos do, and render through one `BrandMark` component
  that CLI logos now use too. `IconReference` svg marks may ask for `fillRule: 'evenodd'`.
- **File-type icons.** The Explorer, the Changes tab, the review pane and file tabs show each file's
  icon by type, tinted by language (`FileIcon`, `fileKind`; tints are tokens `--file-*`).
- **Narrow layouts.** The side panel's narrowest width is 350 px, so its five tabs always fit as
  icons beside the window controls; the review pane hides folder names, totals and tags before
  names; the agent picker keeps the model's name; the commit buttons wrap.
- **Schedules** sits on a surface like every page; the week calendar shows its first hour whole and
  the time zone as a short offset ("+5:30"). The schedule editor reads what and where, then when,
  then Advanced (the app's chevron, not the browser's triangle). New worktree has Cancel and Create
  on the right like every dialog.
- **Words.** Code host errors read as sentences, the common ones reworded ("This repository has no
  GitHub or GitLab remote yet."); the Pull request tab offers settings only when settings can help;
  repeated names are dropped (worktree bar, the Primary's card); the Browser and Updates pages say
  what is true now.

## Consequences

The side panel cannot be dragged narrower than 350 px. File tints are fixed colors, not per theme.
Lettered marks stand in for editors whose logos are not one shape (JetBrains IDEs).
