---
name: hiveory-release
description: Create and publish a Hiveory Windows x64 release when the user asks to make, cut, publish, prepare, tag, or repair a release; synchronize versions, build signed updater artifacts, write standardized notes, push immutable vX.Y.Z tags, and verify GitHub release assets. Do not invoke for ordinary development builds or previews.
---

# Hiveory release

Use this skill for an explicit `$hiveory-release` request or natural-language requests such as "make a new release", "publish Hiveory", "cut v0.2.3", or "repair the 0.2.2 release". A release request authorizes the normal repository mutations required below; it does not authorize force-pushing, moving an existing tag, deleting a release, or publishing an unverified release.

## Policy

- Future tags are annotated `vX.Y.Z`; application manifests remain `X.Y.Z`.
- If no version is supplied, calculate the next patch version from the current synchronized version. Require an explicit version for major, minor, or prerelease releases.
- Release builds are Windows x64 only. Do not add macOS or Linux release jobs or assets; keep their ordinary CI compile coverage unchanged.
- Stop on a dirty worktree, a branch that is not up to date with its upstream default branch, a duplicate tag/version, a failed gate, missing signing credentials, a malformed changelog section, or any upload/verification failure.
- Never force-push, move, or delete tags. Never call a release successful until the verification command passes.

## Standard workflow

1. Inspect the current branch, remote, version, tags, and worktree. Confirm the requested version and derive the previous release tag.
2. Run `node tools/scripts/hiveory-release.mjs next-version` for the default patch bump, or `node tools/scripts/hiveory-release.mjs sync-version --version X.Y.Z` for an explicit version. Keep all authoritative package, renderer, Tauri, Cargo workspace, and lockfile versions synchronized. Update `CHANGELOG.md` with concrete user-visible notes before continuing.
3. Run `node tools/scripts/hiveory-release.mjs validate --version X.Y.Z --tag vX.Y.Z` and `pnpm release:check`. Also run the repository-required design, renderer, Rust, and release-utility checks when they are not already included by `release:check`.
4. Generate the release text with `node tools/scripts/hiveory-release.mjs notes --version X.Y.Z`. Use that exact output for the annotated tag message and GitHub release body. Do not replace it with a raw commit dump or an ad-hoc summary.
5. Commit the version/changelog/release-support changes, push the default branch, create the annotated `vX.Y.Z` tag at that commit, and push the tag. Do not tag before gates pass.
6. Wait for the Windows release workflow. Verify the release, tag target, stable/latest status, required Windows assets, signatures, `latest.json`, manifest version, signed NSIS URL, and absence of macOS/Linux assets with `node tools/scripts/hiveory-release.mjs verify-release --tag vX.Y.Z`.

## Release description contract

`notes` emits the canonical description. Keep its structure stable:

- One short summary paragraph.
- `## Highlights` with one to three concrete user-facing outcomes.
- `## Changes` with non-empty `### Added`, `### Changed`, `### Fixed`, and `### Security` categories only.
- `## Windows downloads` naming portable EXE, setup EXE, and MSI.
- `## Auto-update` confirming the signed Windows updater manifest and NSIS bundle.
- `## Verification` listing the release gates and updater checks.
- A full comparison link from the previous release tag.

Use imperative-free, professional language. Describe observable changes, omit unsupported claims, and omit empty categories. The annotated tag message and GitHub body must come from the same generated source.

## Repair mode

For the one-time `0.2.2` repair, run the release workflow manually with `repair_existing=true`, `release_tag=0.2.2`, and `source_ref=0.2.2`. This rebuilds that exact immutable tag, replaces only its Windows assets, publishes signatures and `latest.json`, and runs the same verification. Do not create a `v0.2.2` alias or rewrite the existing tag.

Read [references/release-contract.md](references/release-contract.md) when preparing notes or diagnosing a failed verification.
