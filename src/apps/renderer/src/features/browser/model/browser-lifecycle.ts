const pendingBrowserCloses = new Map<string, number>()

export function cancelScheduledBrowserClose(browserId: string): void {
  const timer = pendingBrowserCloses.get(browserId)
  if (timer === undefined) return
  window.clearTimeout(timer)
  pendingBrowserCloses.delete(browserId)
}

export function scheduleBrowserClose(browserId: string, close: () => void): void {
  cancelScheduledBrowserClose(browserId)
  const timer = window.setTimeout(() => {
    if (pendingBrowserCloses.get(browserId) !== timer) return
    pendingBrowserCloses.delete(browserId)
    close()
  }, 0)
  pendingBrowserCloses.set(browserId, timer)
}
