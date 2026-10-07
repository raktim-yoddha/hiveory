# ADR 0026: Remote SSH, on par with Orca

Builds on ADR 0022 (remote hosts over SSH) and ADR 0025 (devices over Tailscale). Parts of
ADR 0022 are superseded; they are listed at the end.

## Context

Orca's SSH targets (onorca.dev/docs/ssh) offer a picker over `~/.ssh/config`, first-contact
host-key acceptance with the fingerprint shown, MFA and passphrase prompts relayed into the app,
passphrase caching for the session, a Node it installs itself, connection reuse, a live status
chip, remote terminals that survive the app closing (a grace period, with scrollback restored),
and a Ports tab with one-click forwarding.

Hiveory had a typed SSH host and a folder. It used `BatchMode=yes`, so any password, passphrase,
MFA code or new host key failed with "connect once in a terminal". It required Node 20 on the
remote. A dropped link ended every agent on that machine.

## Decision

**The SSH host picker.** Add project › Remote (SSH) and Settings › Remote share
`SshHostField`. It offers the user's Tailscale devices (online first) and their `~/.ssh/config`
hosts, following `Include` and skipping wildcard patterns. A config alias that points at a
tailnet device is shown once, under its alias. Picking a host keeps a typed `user@`. Any host
can still be typed.

**ssh asks in the window.** `SshAuth` runs a loopback endpoint guarded by a per-launch token. It
points `SSH_ASKPASS` at Hiveory's own executable in Node mode (`ELECTRON_RUN_AS_NODE`, plus
`NODE_OPTIONS=--require askpass.cjs`) with `SSH_ASKPASS_REQUIRE=force`.
- **Why no wrapper script.** A `.cmd` wrapper on Windows cuts a prompt at its first line, which
  loses the host-key question. Measured with Windows OpenSSH 9.5.
- **How the helper answers.** The preload answers synchronously through a blocking child, so
  Node never loads the prompt text as a script. It does nothing in any other program that
  inherits the variables.
- **What it shows.** Passwords, key passphrases, keyboard-interactive and MFA codes, and ssh's
  own first-contact question (with the full fingerprint) appear as a dialog. The host-key
  question is answered with **Trust and connect**, and ssh then records the key in known_hosts
  itself. A changed host key is refused by ssh before any question.
- **What is remembered.** Passwords and passphrases are reused across ssh processes for the
  session. They live in memory only, never on disk. One-time codes and yes/no answers are never
  reused. A host's answers are forgotten when it refuses a login, or when the same ssh process
  asks again. More than three identical questions in one process cancel it.
- **Where questions go.** A client window shows the server's questions too (`ssh.prompt` is
  broadcast, and `ssh.answer` and `ssh.pending` are remote). Its own tunnel's questions are
  answered locally.
- **Without a window.** Where no window can answer (tests), ssh keeps `BatchMode=yes`.

**Hiveory brings its own Node.** When the remote has no Node 20+, `deploy` installs the official
Node v24.11.0 build for linux-x64, linux-arm64, darwin-x64 or darwin-arm64 into
`~/.hiveory-host/node`.
- **Integrity.** The download is checked against SHA-256 sums pinned in the code.
- **Use.** Every remote command runs under `sh -c '…'`, so fish, csh and the rest work, with
  that Node first on PATH. The daemon keeps it on PATH for the CLIs it starts.
- **Where it can't.** musl, 32-bit and other systems get the old "install Node" message.

**Connection reuse.** The short remote commands use OpenSSH ControlMaster on macOS and Linux
(`/tmp/hiveory-ssh-%C`, kept 60 s). Windows OpenSSH has none; there the cached answers keep it
to one question.

**Remote terminals outlive the link (host protocol 2).**
- **The daemon.** On a remote machine, hiveoryd runs detached (`--daemon`, its own session) on a
  `0600` unix socket next to `host.mjs`. Each SSH connection runs `--attach`, a pipe that starts
  the daemon when none answers.
- **While the link is down.** Terminals keep running, and their output is kept (2 MB each).
- **Taking terminals back.** `pty.attach` returns a terminal's kept output, or how it ended.
  `HostClient.adopt` moves every terminal to the new link, and `moved` re-points its writes.
- **Reconnecting.** `HostRegistry` keeps the same kit and reconnects with backoff (1 s up to
  15 s) for 5 minutes, the daemon's own grace period. It asks for the same remote hook port
  again, so agents started earlier keep reporting status.
- **Giving up.** After 5 minutes the agents stop, as before.
- **Ending.** A daemon with nobody attached ends after 5 minutes, or after 1 minute when it
  holds no terminals.
- **Locally.** The local daemon still ends its terminals with its parent.

**Live status.** `hosts.changed` and `hosts.status` report `connecting`, `connected`,
`reconnecting` or `offline` for each host. The host badge shows a dot (green, amber or red).
Notices say when a host is lost, reconnected, or given up on.

**Ports.** Remote projects get a **Ports** button.
- **Finding ports.** It lists listening TCP ports from `/proc/net/tcp` and `tcp6` (Linux), or
  `lsof` (macOS). SSH and Hiveory's own hook tunnel are hidden.
- **Forwarding.** **Forward** opens `ssh -L` to the remote's `localhost`, on the same port
  number here when it is free (privileged ports move up by 10000), and opens it in the system
  browser.
- **Lifetime.** Forwards last until stopped or until Hiveory quits.
- **From a client.** `ports.*` is not remote: forwarding to a server's loopback would not help a
  client.

## Verified

The built app on Windows against a Debian sshd in Docker, using password login and no Node on
the host:
- The picker listed the test config's host.
- **Trust and connect** showed the full multi-line fingerprint.
- The password was asked once across every ssh process.
- Node v24.11.0 was installed and checked against its sum, then node-pty, and browsing worked
  (22 s cold, 2 s warm).
- The project was added and a remote `bash` agent opened.
- After the SSH link was killed, the status went reconnecting, then connected, within about a
  second. The same bash kept its output and took new input, the daemon PID was unchanged, and
  no password was asked again.
- `python3 -m http.server 8123` there was listed, forwarded to `localhost:8123`, and answered
  HTTP 200.

## Superseded in ADR 0022

- "BatchMode means it never prompts" and "host keys are never accepted on Hiveory's own". ssh
  still never accepts a key by itself; the user accepts it in Hiveory, from ssh's own prompt.
- "Hiveory never asks for or stores passwords". It asks when ssh needs one, and keeps it in
  memory only.
- "Requires Node 20 on the remote".
- "Losing the connection stops that machine's agents". They stop only after the 5-minute grace
  period.

## Consequences

- `systemd-logind` with `KillUserProcesses=yes` kills the detached daemon at logout. Users with
  that setting need `loginctl enable-linger`.
- Windows remote hosts remain unsupported: the probe and the daemon socket assume POSIX.
