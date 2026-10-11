import type { MouseEvent } from 'react'

/** What a click lands on that has its own job: it keeps the focus. */
const INTERACTIVE = 'a, button, input, textarea, select, label, summary, details, [contenteditable="true"], [role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="link"]'

/**
 * A click anywhere in a chat goes to its message box (ADR 0043), unless it hit something with its own
 * job or ended a text selection (copying a reply must keep working).
 */
export const focusChatInput = (event: MouseEvent<HTMLElement>): void => {
  if ((event.target as HTMLElement).closest(INTERACTIVE)) return
  if (window.getSelection()?.toString()) return
  const scope = event.currentTarget.closest('[data-chat]') ?? event.currentTarget.parentElement
  scope?.querySelector<HTMLTextAreaElement>('[data-chat-input]')?.focus({ preventScroll: true })
}
