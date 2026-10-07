# ADR 0032 — Bot computers: Podman, a pinned image, the UI tree and shared seats

Builds on ADR 0022 (each bot's Linux computer). Closes the gaps against OpenMausBot listed in
`docs/plans/bots-feature-scope.md`. Decided by the agent on the product owner's standing
instruction, 2026-10-08.

## Decision

- **Docker or Podman.** On each machine (this computer or an SSH host) Hiveory uses Docker when its
  daemon answers, else Podman (`podman info`), found once per session. Both take the same arguments;
  only the image build differs: Docker reads the file from stdin with no context (`build -`), Podman
  needs `-f -` and an empty context folder (a temp folder here; `mktemp -d` on an SSH host). Errors
  say which one to start, or that neither is installed.
- **A pinned image.** The image starts `FROM debian:bookworm-slim@sha256:7c7b…c587` (the multi-arch
  index of 2026-10-08), so a retagged upstream image can't change what a bot's computer runs.
  Packages still come from Debian's current bookworm repository. Re-pin on purpose, with a new
  `COMPUTER_IMAGE_VERSION`. Its scripts are embedded as base64, so no quoting can break them.
- **Rebuild.** A container records the image version it came from; an older one shows "It runs an
  older desktop image" and the Computer tab offers **Rebuild** (confirmed): the container is removed
  (only one labelled as this bot's) and made again; `/workspace` stays. Nothing is rebuilt on its own.
- **Reading the screen as UI elements.** The desktop runs a session bus with the accessibility bus
  (AT-SPI); `desktop_ui` prints each visible element's role, name and centre point (at most 400),
  from `hiveory-ui-tree` (Python, pyatspi) inside the container. Chromium opens with renderer
  accessibility on, so pages are included. The bot clicks with `desktop_click` at those points.
  An older image gets "ask the user to rebuild it".
- **Shared seats.** `BotComputer` may be `{ kind: 'shared', botId }`: a seat on another bot's
  computer (one with its own). Both use one container, one `/workspace` and **one lease**: one
  conversation at a time across them. A bot can't share its own computer, sit on a seat, or move
  away while others sit on its computer. The Works on card "Share a computer" picks whose.

## Not verified live

Docker Desktop was not running and Podman is not installed on the machine this was built on: the
engine choice, the Podman build, rebuilds, seats and the UI tree are covered by tests with a fake
engine, and both embedded scripts pass `sh -n` and `py_compile`. The first real build will show
whether AT-SPI exposes Chromium's tree in Xvfb as expected.
