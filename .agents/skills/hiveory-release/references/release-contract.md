# Hiveory release contract

## Inputs

- Application version: `X.Y.Z`.
- Git tag: `vX.Y.Z` for new releases; the historical `0.2.2` tag is repair-only.
- Canonical notes: the matching `CHANGELOG.md` section.

## Required stable assets

- `Hiveory-portable.exe`
- `Hiveory-setup.exe`
- `Hiveory.msi`
- `Hiveory-setup.exe.sig`
- `Hiveory.msi.sig`
- `latest.json`

The release must not contain macOS or Linux bundles. `latest.json` must contain a Windows x64 platform entry with a non-empty signature and an NSIS setup URL.

## Failure handling

Leave the source commit and tag intact when publication or verification fails. Report the failing command and preserve logs for a retry. A retry may update assets on the same existing GitHub release, but may not move the tag or silently publish a different version.
