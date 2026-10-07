import { useEffect } from 'react'
import { usePush } from './push'

/** The web build has no push notifications to route; it only reads the saved switch. */
export function NotificationRouter() {
  useEffect(() => {
    void usePush.getState().load()
  }, [])
  return null
}
