# ADR 0027 — The phone app

Builds on ADR 0022 (Hiveory as a server), ADR 0025 (devices over Tailscale) and ADR 0026
(remote SSH).

## Context

Users want to watch and steer their agents from a phone. Orca ships a mobile companion: an Expo /
React Native app in its own repository folder (`orca/mobile/`), a separate pnpm workspace with
its own lockfile. It talks to the desktop over WebSocket and relays push notifications through
its own cloud gateway.

The product owner decided:
- **Push:** Expo's push service, sent straight from the user's computer. No Hiveory server.
- **What a phone may do:** everyday control. It can watch, steer and open agents, type in their
  terminals, chat, answer SSH questions and create workspaces. Deleting, settings and accounts
  stay on the desktop.
- **This pass:** the foundation plus the core flows.

## Decision

**Where it lives.** `mobile/` sits in this repository as its own pnpm workspace, as Orca does.
- It has its own `package.json`, `pnpm-workspace.yaml` (`nodeLinker: hoisted`, Expo's monorepo
  advice) and lockfile.
- React Native pins React and its native modules to the Expo SDK, so the phone never shares an
  install with Electron. The root workspace lists only the desktop.
- Root scripts reach it: `pnpm mobile <script>`, `pnpm mobile:install`, `pnpm mobile:check`.
- The root lint ignores `mobile/`, which has its own.

**One contract, shared as types.**
- The phone imports the desktop's `src/shared` types (`@shared/*`, type-only). The request and
  response shapes therefore come from one place, and the phone's typecheck fails when the
  desktop changes them.
- A few dependency-free modules are also used at runtime: `domain/tailnet`, `domain/cli`,
  `domain/project`, `domain/workspace`, `ipc/remote`. Lint enforces this list.
- Metro watches `src/shared` only and resolves every package from `mobile/node_modules`.
- A test checks that every channel the phone calls is in the server's `MOBILE_CHANNELS`.

**Stack.** Expo SDK 57 (React Native 0.86, React 19.2) with:
- Expo Router (`src/app`), TanStack Query for server state, zustand for local state.
- `react-native-sse` for the live event stream, `react-native-webview` with xterm.js for
  terminals.
- `expo-camera` for QR pairing, `expo-secure-store` for tokens, `expo-notifications` for push.
- `lucide-react-native` icons, and Vitest for logic tests.

**Architecture, enforced by lint (`mobile/eslint.config.js`).**
- **`src/app`:** routes only. Each composes features through their public `index.ts`, and
  exports `RouteErrorBoundary`, so a crash stays inside its screen.
- **`src/features/<name>`:** islands. A feature never imports another feature or a route.
  Screens take slots (`InboxScreen aside`, `SettingsScreen notifications`) so routes can combine
  features without them knowing each other.
  - **`onboarding`:** first run and pairing.
  - **`inbox`:** what needs you, across projects.
  - **`projects`:** the project board and its workspaces.
  - **`workspace`:** a workspace's agents; open an agent or a preset.
  - **`agent`:** the live terminal, the needs-you bar, keys, messages and actions.
  - **`ssh-prompts`:** answering the computer's SSH questions.
  - **`notifications`:** push registration and opening the agent a notification is about.
  - **`settings`:** paired computers, notifications, appearance and privacy.
- **`src/core`:** infrastructure and UI shared by every feature. It never imports a feature or
  a route.
  - **`api`:** typed calls, the event stream, cache refresh driven by events, and the
    connection.
  - **`computers`:** the store of paired computers, and pairing.
  - **`theme`:** design tokens.
  - **`ui`:** the design system.
  - **`terminal`:** the terminal view and its data feed.
  - **`routes`:** route builders, and **`boundary`:** the error boundaries.
- **App-wide layers** (SSH questions, notification taps, notices) each sit in a
  `LayerBoundary`. A failing layer renders nothing and every screen keeps working. The preview
  run showed why this is needed: an unsupported notifications call on web crashed the whole
  shell before the boundaries were added.

**Look.**
- The palettes are the desktop's own: `pnpm mobile sync:theme` generates them from
  `src/renderer/src/styles/tokens.css`, and a test fails when they drift.
- The phone follows the theme picked on the computer.
- Sizes are the desktop's rhythm made for thumbs: the same spacing steps, rounder corners,
  15–17 pt body text and 44-point touch targets.
- The design rules carry over: flat surfaces with air between them, saturated color only for
  status, selection as a tinted fill, and an amber edge only on what needs you.
- The phone uses the system font; the desktop's dense 11–13 px scale would not read on a phone.

**The phone's screens.**
- **Inbox (home):** agents that need you across every project, then those working, with a badge
  on the tab.
- **Projects:** each project's live counts. A project's board shows one status at a time
  (Needs you, Working, Idle), most urgent first, followed by its workspaces and a "New
  workspace" sheet.
- **Workspace:** its agents, and an "Open an agent" sheet listing the CLIs and presets on that
  machine (from its registry).
- **Agent:**
  - The terminal is drawn at the computer's own size; the phone never resizes it. Text stays at
    9.5 px or larger, with sideways panning and pinch to zoom.
  - When the agent needs you, a bar says why and offers Esc and Enter.
  - A row of keys (Esc, Tab, arrows, ^C, ⏎), a message box (`agents.sendMessage`), and actions:
    interrupt, restart, redraw, close.
- **Settings:** paired computers (switch or forget), the notifications switch, the theme, and a
  privacy note.
- **Pairing:** scan the QR code from the desktop, open its `hiveory://pair` link, or type an
  address. No code is needed on the same Tailscale account.

**What changed on the desktop.**
- **Phone scope:** `/pair` with `client: 'mobile'` gives the device the `mobile` scope. The
  server refuses any channel outside `MOBILE_CHANNELS`, whatever the phone asks for. Paired
  devices show as Phone or Desktop.
- **Data use:** `/events?terminal=none` streams everything but terminal output;
  `/events?terminal=<id>` streams that one terminal. A phone never downloads every agent's
  output.
- **Terminal size:** `terminal.snapshot` includes the terminal's `cols` and `rows`, so the phone
  draws it at that size. `terminal.resize` is not a phone channel.
- **Push:**
  - `POST /push` stores a device's Expo push token. Only the `Expo(nent)PushToken[…]` shape is
    accepted.
  - When an agent starts waiting, the computer sends "An agent needs you." through Expo, at
    most once a minute per agent. Only ids travel: the agent, project, workspace and the
    computer's own address. Tokens that Expo reports as gone are dropped.
- **QR code:** Settings › Remote › Share this computer shows a QR code ("Connect your phone"),
  drawn as SVG with `uqr`.

## Verified

- **Native bundles:** `expo export` builds Hermes bundles for Android and iOS, including the
  shared code and the terminal page. This check caught a React Navigation import that SDK 56+
  forbids.
- **Live run:** the desktop app served a project with three agents (two stand-in CLIs on PATH
  and PowerShell). The phone's web build ran in a 390×844 window:
  - It paired as a phone, showed the waiting agent on the inbox (with badge), the project board,
    the workspace and the open-agent sheet.
  - On the agent screen, I sent "y". The agent printed "Applied: y" and moved from Needs you to
    Idle on both sides.
- **Settings:** the screen showed the connection.
- **Tests:** server tests cover the phone scope (refused deletes, settings and resize), the
  terminal stream filters and the push-token endpoint. Phone tests cover the contract, theme
  parity, pairing (with and without a code), the secure computer store, cache refresh, emitter
  isolation and terminal chunk merging.

## Consequences and next

- **Push needs setup:** an EAS project id (`eas init`) and an installed development or store
  build; Expo Go cannot receive push. Without it, the switch says why.
- **iOS:** `NSAllowsArbitraryLoads` is set because the app speaks plain HTTP to the user's own
  computers, which Tailscale already encrypts. App review may ask about it. Serving over HTTPS
  with a Tailscale certificate would remove it.
- **Expo-doctor:** it reports a duplicate React from the desktop's `node_modules` above
  `mobile/`. Metro never reads that folder (it watches `mobile/` and `src/shared` only).
- **Next:** chat-view agents (they get a message box and a note for now), Queen Bee, Bots, and
  store icons and screenshots.

## Amendment (2026-10-09): chat-view agents on the phone

Decided by the product owner, 2026-10-09.

- A chat-view agent opens on the phone as its conversation: the user's messages and the agent's
  replies, live, with "Working…" while it answers. The phone reads it with `chat.get` (already in
  `MOBILE_CHANNELS`) and follows `chat.event`. Its key bar is hidden: there is no terminal to press
  keys into.
- A sent message shows at once on every screen, whoever sent it (the phone, Queen Bee, another
  agent): main now broadcasts the user's message as a `chat.event` before the reply starts.
- The terminal key bar gains `/` after Tab, since slash commands start every CLI's commands.

## Amendment (2026-10-09): the phone's chat view matches the computer's

Decided by the product owner, 2026-10-09.

- Replies render as markdown (headings, bold, lists, code, quotes, tables, links), like the
  computer. The phone parses with `marked` (the desktop's own parser, now a phone dependency) and
  draws native text; raw HTML is shown as text, never run, and only web links open.
- A chat-view agent's model and reasoning effort can be picked on the phone. The new channel
  `chat.setModel` (in `MOBILE_CHANNELS`) changes only those two; permissions and everything else in
  `chat.update` stay on the computer.
- A chat's settings change announces itself (`state.changed` with `chatId`), so the computer and
  the phone both show the new model at once, whichever changed it.
- The message box empties the moment Send is tapped and refills if sending fails.
