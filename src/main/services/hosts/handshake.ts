import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

/**
 * The mutual hello of a local daemon connection (ADR 0050 §2): each side proves it holds the
 * daemon's token by answering the other's nonce, so a pipe squatted by another user gets
 * neither keystrokes nor agent environments, and a stranger cannot drive the daemon.
 */
export type HandshakeRole = 'daemon' | 'client'

export const newNonce = (): string => randomBytes(32).toString('hex')

export const newToken = (): string => randomBytes(32).toString('hex')

export const prove = (token: string, role: HandshakeRole, nonce: string): string =>
  createHmac('sha256', token).update(`${role}:${nonce}`).digest('hex')

export const verifyProof = (token: string, role: HandshakeRole, nonce: string, proof: unknown): boolean => {
  if (typeof proof !== 'string') return false
  const want = Buffer.from(prove(token, role, nonce))
  const got = Buffer.from(proof)
  return got.length === want.length && timingSafeEqual(got, want)
}
