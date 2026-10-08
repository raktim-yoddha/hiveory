import type { ReactElement } from 'react'

/** Elsewhere the sheet is drawn in the app's own window, so its content needs no host. */
export function SheetContent({ children }: { children: ReactElement }) {
  return children
}
