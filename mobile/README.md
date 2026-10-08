# Hiveory for phones

Watch and steer your agents from your phone: what needs you, every workspace's board, live
terminals, answering prompts, and push notifications. The app talks only to your own computers,
over your own Tailscale network (ADR 0025, 0027). The one exception: the Android app asks GitHub for
the latest release when it opens (Settings › Updates turns it off).

## Run it

From the repository root (or `pnpm <script>` inside `mobile/`):

```bash
pnpm mobile:install
```

```bash
pnpm mobile start
```

- **Expo Go** on your phone runs everything except push notifications.
- **A development build** adds push: run `npx expo run:android` or `npx expo run:ios`, or use
  `npx eas-cli build --profile development`.
- **Push setup:** link an EAS project once with `npx eas-cli init`. That writes
  `extra.eas.projectId`, which Expo push requires.

Then, on the computer, open Hiveory › Settings › Remote and turn on **Share this computer**. In
the app, scan **Connect your phone**. Both devices need Tailscale signed in; with the same
account, no code is asked.

## Checks

```bash
pnpm mobile:check
```

This runs typecheck, lint (including the architecture rules below) and the Vitest logic tests.
After changing the desktop's `tokens.css`, run `pnpm mobile sync:theme`.

## End-to-end tests (Android)

Maestro drives the app in Expo Go on a real Android phone against a throwaway Hiveory server with a
stand-in agent (ADR 0036). Your own agents, workspaces and settings are never touched.

One-time setup:

1. On the phone: Developer options › **Wireless debugging** on, then **Pair device with pairing code**.
2. On the computer: `adb pair <ip:port>` (type the code), then `adb connect <ip:port>` from the top
   of the Wireless debugging screen. `adb devices` must list exactly one phone.
3. Java 17 and Maestro, by default in `%LOCALAPPDATA%\hiveory-e2e` (or set `JAVA_HOME` and `MAESTRO`).

Each run (Metro must be running):

```bash
pnpm build
```

```bash
pnpm mobile e2e
```

`pnpm mobile e2e <name>` runs only the flows whose file name contains it; `--serve-only` starts just
the seeded server to try the app by hand. The flows live in `e2e/flows`.

## Architecture

| Folder | What lives there | May import |
|---|---|---|
| `src/app` | Expo Router routes only: each composes features and exports `RouteErrorBoundary` | `@/core`, a feature's `index` |
| `src/features/<name>` | One island per feature: its screens, sheets, hooks and state | `@/core`, its own files |
| `src/core` | What every feature shares: `api`, `computers`, `theme`, `ui`, `terminal`, `routes`, `boundary` | `@/core` only |
| `@shared/*` | The desktop's `src/shared`: types (`import type`), and a few dependency-free modules | — |

Rules (lint fails otherwise):

- A feature never imports another feature or a route. Routes combine features, often through
  slots: `<InboxScreen aside={<PushSuggestion />} />`.
- `core` never imports a feature or a route.
- Routes use a feature only through its `index.ts`.
- Code from the desktop is type-only, except the modules listed in `eslint.config.js`.
- Climbing more than one folder (`../../`) is not allowed; use `@/…`.

Failure stays local:

- Every route exports an error boundary.
- App-wide layers (SSH questions, notification taps, notices) each sit in a `LayerBoundary`.
- Each screen's data is its own query, refreshed by the computer's live events (`core/api`).

Look: the desktop's palettes, generated from `src/renderer/src/styles/tokens.css`, with sizes
made for touch (`core/theme/tokens.ts`). Build screens from `core/ui`; don't style one-offs.
The structure is each platform's own: the system tab bar (SF Symbols / Material icons), native
stack headers (`useHeaderOptions`, `TabStack`), native sheets (`Sheet`: SwiftUI on iOS, Material 3
on Android, via `@expo/ui`), iOS action sheets, system switches and native touch feedback
(`ripple` / `pressedFill`) — tinted with the desktop's colors. The screens themselves (cards, rows,
buttons, the segmented control) stay the desktop's design on both platforms.

## Notes

- **Expo-doctor** reports a duplicate React found in the desktop's `node_modules` above this
  folder. Metro never reads it: it watches only `mobile/` and `src/shared`
  (`metro.config.js`).
- **The web build** (`pnpm mobile start --web`) exists for previews. Phones are the product.
