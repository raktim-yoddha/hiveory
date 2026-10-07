# ADR 0025 — Your devices over Tailscale

Builds on ADR 0022 (Hiveory as a server, the desktop as its client).

## Context

ADR 0022 made Hiveory a server (`hiveory --serve`) and the desktop its client, but connecting
was manual: start the server headless, then type an SSH host or address, a port and the one-time
code it printed. A desktop could not share itself at all.

We looked at how Orca (onorca.dev) does it. Its remote servers work over the user's own
Tailscale: the server picks its `100.x` address and generates a one-time access link, and the
client pastes that link. SSH targets are a separate, manual list (prefilled from `~/.ssh/config`).
Nothing is discovered automatically, and every device still needs a link copied across.

## Decision

**Tailscale is the network; Hiveory runs no relay or cloud service.** Tailscale already gives
NAT traversal (with DERP relays when direct paths fail), WireGuard encryption between devices,
stable `100.x` addresses, MagicDNS names and an identity for every device. Hiveory reads all of
this through the user's own `tailscale` CLI (`status --json`, `whois --json`). It never signs
in, changes tailnet settings, runs `tailscale serve`, or stores anything of Tailscale's.
Without Tailscale, the SSH and manual paths from ADR 0022 still work.

**Share this computer.** Settings › Remote has a "Share this computer" switch
(`settings.shareOnTailnet`, off by default). When it is on, this desktop keeps running
everything and also serves the ADR 0022 server on port 7788, on loopback and on its Tailscale
address only. It never listens on the LAN or `0.0.0.0`. The address is re-read every 30 seconds,
so sharing follows Tailscale coming up after boot, going down, or getting a new address. The
headless server gets the same with `hiveory --serve <port> --tailscale`.

**Your devices.** The Remote page lists the tailnet's devices from `tailscale status`. Each
online device is probed once at `http://<tailscale ip>:7788/health` (1.5 s timeout, in
parallel). Devices that answer as Hiveory show **Connect**. Other online devices show **Use over
SSH**, which fills the SSH host field with the device's MagicDNS name. Offline devices are only
listed.

**One-click pairing for the owner's own devices.** A pairing request without a code is accepted
only when Tailscale says the connecting socket address belongs to the same Tailscale login as
the server (`whois` on `req.socket.remoteAddress`, checked to be in `100.64.0.0/10` or
`fd7a:115c:a1e0::/48`). Nothing in the request is trusted. Tagged nodes belong to no person, so
they never pair without a code. Other accounts (node sharing), tagged servers, loopback and SSH
tunnels get `needsCode`, and the picker asks for the code the sharing computer shows. Failed
code-less attempts count toward the same 10-per-10-minutes pairing limit.

**Durable connection.** A tailnet client stores the device's name and address
(`{ via: 'tailnet', ip, port, name }`). Each reconnect looks the name up again in
`tailscale status`, so a device that got a new address is found again. ADR 0022's backoff
reconnect is unchanged.

**Paired devices can be removed.** The sharing computer lists its paired devices. Removing one
deletes its token hash and immediately ends that device's open event stream.

## Consequences

- Plain HTTP over the tailnet is acceptable: WireGuard already encrypts and authenticates every
  packet. Direct addresses outside the tailnet still need the user's own HTTPS proxy.
- On Windows, the first listen on the Tailscale address may show a firewall prompt.
- Discovery only finds servers on the default port 7788. A headless server on another port is
  still reached manually.
- `share.*` channels are not remote: a client cannot read the server's pairing code. A paired
  client can still switch sharing off through `settings.update`, as it can any other setting.
- Not yet: a phone client, and approving a non-owner device on the sharing computer's screen
  instead of typing its code.
