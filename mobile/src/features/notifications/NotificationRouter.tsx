import { useEffect } from 'react'
import * as Notifications from 'expo-notifications'
import { router } from 'expo-router'
import { useComputers } from '@/core/computers'
import { routes } from '@/core/routes'
import { usePush } from './push'

// While the app is open, a "needs you" shows as a banner too: it may be about another computer or project.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true })
})

/**
 * Opens the agent a tapped notification is about (it carries only ids, ADR 0027),
 * switching to the computer that sent it, and keeps this phone's push token
 * registered with every computer when it changes.
 */
export function NotificationRouter() {
  const lastResponse = Notifications.useLastNotificationResponse()

  useEffect(() => {
    void usePush.getState().load()
  }, [])

  useEffect(() => {
    const data = lastResponse?.notification.request.content.data as Record<string, string> | undefined
    if (!data?.instanceId || !data.workspaceId || !data.projectId) return
    const { computers, setActive } = useComputers.getState()
    const from = computers.find((c) => c.address === data.from)
    void (from ? setActive(from.id) : Promise.resolve()).then(() => router.push(routes.agent(data.instanceId!, data.workspaceId!, data.projectId!)))
  }, [lastResponse])

  // A rolled push token stops delivering silently: hand the new one to every computer.
  useEffect(() => {
    const sub = Notifications.addPushTokenListener(() => {
      if (usePush.getState().status !== 'on') return
      const { computers, tokens } = useComputers.getState()
      void usePush.getState().enable(computers.flatMap((c) => (tokens[c.id] ? [{ computer: c, token: tokens[c.id]! }] : [])))
    })
    return () => sub.remove()
  }, [])

  return null
}
