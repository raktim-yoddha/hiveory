/** One device on the user's tailnet (ADR 0025), normalized from Tailscale's own status. */
export interface TailnetDevice {
  /** Its machine name, e.g. "devbox". */
  name: string
  /** Its MagicDNS name, e.g. "devbox.tail1234.ts.net" ('' when MagicDNS is off). */
  dnsName: string
  /** Its stable Tailscale address (IPv4 when it has one). */
  ip: string
  os: string
  online: boolean
  /** The Tailscale login it belongs to; '' for tagged (shared) nodes. */
  owner: string
}

export interface TailnetStatus {
  /** missing: Tailscale is not installed here; stopped: installed but off or signed out. */
  state: 'missing' | 'stopped' | 'running'
  self?: TailnetDevice
  devices: TailnetDevice[]
}

/** A tailnet device as the client's picker shows it. */
export interface DiscoveredDevice extends TailnetDevice {
  /** Set when a Hiveory server answers on it (the default port). */
  hiveory?: { version: string; port: number }
  /** Same Tailscale login as this computer: pairing needs no code. */
  mine: boolean
}

export interface Discovery {
  state: TailnetStatus['state']
  devices: DiscoveredDevice[]
}

/** A device paired with this computer's server. */
export interface PairedDevice {
  id: string
  name: string
  pairedAt: string
}

/** "Share this computer" (ADR 0025): this desktop also serves its window to the user's other devices. */
export interface ShareStatus {
  state: 'off' | 'on' | 'no-tailscale' | 'error'
  /** How other devices reach it, e.g. "devbox.tail1234.ts.net" or a Tailscale address. */
  address?: string
  port?: number
  /** For devices signed in to another Tailscale account (or over SSH). */
  code?: string
  /** Devices signed in to this Tailscale login pair with one click. */
  owner?: string
  devices: PairedDevice[]
  detail?: string
}
