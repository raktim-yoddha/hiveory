# ADR 0035 — Releases: retroactive versions, one changelog, CI builds and in-app updates

Decided by the product owner, 2026-10-08.

## Context

Hiveory had 102 commits and no versions: `package.json` said `0.1.0`, there were no tags and no GitHub
releases. `pnpm release` built an installer only for the machine it ran on (Windows), the release body
was empty, the desktop updater had no pop-up, and the phone app could not update itself.

## Decision

**Retroactive versions.** The history is split into 26 versions, v0.1.0 to v0.20.0, tagged on the
commit that ended each one (annotated tags dated with that commit). A run of `feat` commits is a minor
version, a run of only fixes is a patch; a deliberate user-facing change made in `fix` commits (the
Workspace/Worktree rename, v0.19.0) is a minor. Before 1.0 a breaking change bumps the minor
(SemVer §4): v0.12.0. These releases carry source code only: their commits still say `0.1.0` in
`package.json`, so an installer built from them would be mislabelled. One manual edit, setting
`package.json` and the phone app to `0.20.0`, aligns the files with the tags; it is the only exception
to "never edit the version by hand" (AGENTS.md §26).

**One source for release text.** `CHANGELOG.md` holds each version's title and two to six
plain-language highlights (what changed for the user, no code names, no marketing). New work goes
under `## Unreleased — Title`; `pnpm release` stamps it with the version and date.
`scripts/release-notes.mjs` builds each GitHub release from that entry plus the commits since the
previous tag, grouped by Conventional Commit type and quoted as written, with a compare link.

**CI builds every installer.** `pnpm release X.Y.Z` now validates, bumps the desktop and phone versions
(Android `versionCode` = MAJOR MINOR PATCH then 99, or the prerelease number), commits, tags and
pushes. `.github/workflows/release.yml` drafts the release, builds Windows (NSIS x64), macOS (Apple
Silicon dmg + zip) and Linux (AppImage + deb) installers and the signed Android APK in parallel, then
publishes the draft as Latest only when all of them pass. `.github/workflows/ci.yml` runs typecheck,
lint and tests on all three desktop OSes and the phone checks on every push and pull request.

**One version for desktop and phone.** The phone app carries the desktop's version (decided by the
product owner): both talk through `src/shared`, so one number says which builds work together, and
the phone's update check compares itself with the same release tags. A release with no phone
changes still moves the phone's version.

**Updates.** The desktop shows a pop-up when an update is found (highlights, Download, then Restart
and update; Later installs on quit) and Settings › Updates gains "Download automatically" (off by
default) next to "Check automatically" (on). The Android app asks GitHub for the latest release when
it opens (Settings › Updates turns this off) and offers the APK in a native pop-up; Android always asks
the user to confirm the install.

## Consequences

- macOS installers are unsigned until an Apple Developer certificate is added as a secret; macOS
  refuses to apply updates to an unsigned app, so Mac users update by downloading the new dmg.
- Intel Macs have no build: two Mac jobs would overwrite each other's `latest-mac.yml`.
- The Android signing key is a GitHub secret (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`)
  and must be kept forever: an APK signed with another key cannot update the installed app.
- The phone's GitHub check is its only request outside the user's own computers; the privacy text
  says so.
- Over-the-air JavaScript updates (expo-updates) need an Expo account and are not part of this.

## Amendment (2026-10-09): the command is `release`

Decided by the product owner. The user says "release" and the agent picks the version:
`pnpm release next` reads the commits since the last tag and prints the next SemVer step and why
(`suggestRelease` in `scripts/semver.mjs`: breaking → major, minor before 1.0; `feat` → minor; other
user-facing commits → patch; docs, tests, CI and chores alone → nothing to release). The agent checks
that against the commits, writes the changelog entry, then runs `pnpm release X.Y.Z --check` and
`pnpm release X.Y.Z` as before. The steps live in AGENTS.md §26 only; the README no longer repeats them.
