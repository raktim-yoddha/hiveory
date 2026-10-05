import { useEffect, useState } from 'react'

const OVERLAY = '[role="menu"], [role="listbox"], [role="dialog"], dialog[open], [data-steps-aside]'

export const isOverlayOpen = (): boolean => Boolean(document.querySelector(OVERLAY))

/**
 * True while a menu, listbox, popover or dialog is open anywhere in the window. The browser page
 * is a native view drawn above the app, so it steps aside while one is open.
 */
export function useOverlayOpen(): boolean {
  const [open, setOpen] = useState(isOverlayOpen)
  useEffect(() => {
    const check = (): void => setOpen(isOverlayOpen())
    const observer = new MutationObserver(check)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'role', 'data-steps-aside'] })
    check()
    return () => observer.disconnect()
  }, [])
  return open
}
