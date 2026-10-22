# ADR 0052 — Every device over Tailscale or Wi-Fi

Builds on ADR 0025 (Tailscale devices), ADR 0027 (the phone app) and ADR 0039 (sharing on this network).
Decided by the product owner, 2026-10-22.

## Context

Hiveory is a server and its windows are clients, so another PC or a phone can drive any computer
that shares. In practice it only worked well over Tailscale:

- a computer sharing "On this network" could not be found from another PC; its address had to be
  typed under Use a Hiveory server;
- a pairing remembered one address, so a device paired over Tailscale lost the computer when
  Tailscale was off, even on the same Wi-Fi, and the other way round;
- the phone could not answer a bot's request for the user's yes, nor see or run Schedules;
- a paired PC could not stop a Queen Bee plan, write or remove skills, or switch the Trigger link,
  although all of these run on the server.

The product owner asked for both Tailscale and the local Wi-Fi to work from Android and from
another PC, for every mode.

## Decision

- **Finding computers on the Wi-Fi.** A computer that shares "On this network" answers a UDP
  probe (`hiveory-discover-1`) on port 7788 from private addresses only, at most once per second
  per asker, with its name, port and version and nothing else. `client.discover` broadcasts the
  probe and returns the answers as `Discovery.lan`, without this computer itself. Settings ›
  Remote › Your devices lists them under **On this network**, each with a pairing-code field and
  Connect (`client.connect` via `direct`). Being found is not being trusted: a Wi-Fi pairing
  always takes the one-time code.
- **Every address in one pairing.** The `/pair` reply lists every address the computer is reached
  at (its Tailscale name and IP, its Wi-Fi addresses); `ShareStatus.addresses` carries the same
  list. Pairing links take them as `b=` (up to four), so the phone's QR code holds both. A desktop
  client stores them as `alternates` and uses the first address whose `/health` answers. The phone
  stores them on its `Computer`, remembers the address that answered last, and on a failed call or
  dropped event stream looks for another that answers. A call is retried only on a different
  address, so one that did arrive is never run twice. Push notifications match their computer by
  any of its addresses.
- **Phone channels.** `MOBILE_CHANNELS` adds `approvals.list`, `approvals.answer`, `routines.list`
  and `routines.runNow`. The Bots tab shows waiting approvals (Allow or Decline) and a Schedules
  row; a bot's screen shows its own approvals; the Schedules screen lists every Schedule with when
  it runs next, how its last run went, and Run now. Creating and editing Schedules stays on the
  computer.
- **Server mode.** `hiveory --serve 7788 --lan` shares on the local network too (and answers the
  probe), as "On this network" does for a desktop.
- **Desktop client channels.** `REMOTE_CHANNELS` adds `queen.cancelPlan`,
  `extensions.createSkill`, `extensions.removeSkill`, `extensions.copySkill`,
  `triggers.enableLink` and `triggers.disableLink`. What stays out needs the server's own screen,
  dialogs, files or installer (pick a folder, reveal in Explorer, the built-in browser, voice,
  updates, ports).

## Consequences

- Anyone on the same network learns that a computer shares Hiveory, its name and version. That is
  the cost of finding it without typing an address. "On this network" stays off by default and
  says to turn it on only for a trusted network.
- A broadcast does not cross routers or most guest networks; there the address is still typed.
- Approval and Schedule notifications on the phone are not part of this; the phone sees them when
  it opens the Bots tab.
- The phone can run a Schedule but not change one, and a paired PC still cannot use the server's
  folder picker or Explorer.
