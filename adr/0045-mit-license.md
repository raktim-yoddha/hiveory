# ADR 0045 — Hiveory is MIT licensed

Decided by the product owner, 2026-10-12.

## Context

The repository is public and ships installers, but it had no license file, so nobody had clear
permission to use, change or share the code.

## Decision

Hiveory, desktop and phone app alike, is released under the MIT License. The text is in `LICENSE` at
the repository root, `package.json` and `mobile/package.json` declare `"license": "MIT"`, and the
README links it.

## Consequences

Anyone may use, copy, modify and redistribute Hiveory, including commercially, as long as the
copyright notice stays. Dependencies keep their own licenses; adding one under a license that is not
compatible with MIT needs its own ADR.
