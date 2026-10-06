/** Electron's safeStorage, or a stand-in for tests. */
export interface Sealer {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

/**
 * Seals API keys and server secrets before they reach the state file:
 * OS-encrypted (DPAPI, Keychain, libsecret) when available, else only
 * encoded — the Linux-without-keyring case, reported by `encrypted`.
 */
export class SecretBox {
  constructor(private readonly sealer: Sealer | null) {}

  get encrypted(): boolean {
    return Boolean(this.sealer?.isEncryptionAvailable())
  }

  seal(value: string): string {
    if (this.encrypted) return `v1:${this.sealer!.encryptString(value).toString('base64')}`
    return `p1:${Buffer.from(value, 'utf8').toString('base64')}`
  }

  open(sealed: string): string {
    if (sealed.startsWith('v1:')) {
      try {
        return this.sealer?.decryptString(Buffer.from(sealed.slice(3), 'base64')) ?? ''
      } catch {
        // Sealed on another machine or user account: the user enters it again.
        return ''
      }
    }
    if (sealed.startsWith('p1:')) return Buffer.from(sealed.slice(3), 'base64').toString('utf8')
    return sealed
  }
}
