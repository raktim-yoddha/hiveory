/**
 * Only Hiveory's own renderer may call privileged IPC (Electron security
 * checklist: validate the sender of all IPC messages).
 */
export const isTrustedSenderUrl = (url: string | undefined, devServerUrl: string | undefined, rendererFile: string): boolean => {
  if (!url) return false
  if (devServerUrl) {
    try {
      return new URL(url).origin === new URL(devServerUrl).origin
    } catch {
      return false
    }
  }
  try {
    const parsed = new URL(url)
    const expected = new URL(`file:///${rendererFile.replace(/\\/g, '/').replace(/^\/+/, '')}`)
    return parsed.protocol === 'file:' && decodeURIComponent(parsed.pathname).toLowerCase() === decodeURIComponent(expected.pathname).toLowerCase()
  } catch {
    return false
  }
}
