import type { ReactElement } from 'react'
import { RNHostView } from '@expo/ui/jetpack-compose'

/**
 * React Native content inside the native (Compose) sheet. The sheet is its own window, so the
 * content must be hosted to receive touches; without it no button in a sheet responds.
 */
export function SheetContent({ children }: { children: ReactElement }) {
  return <RNHostView matchContents>{children}</RNHostView>
}
