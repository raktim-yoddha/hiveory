import { useEffect } from 'react'
import { ActionSheetIOS, Alert, Platform } from 'react-native'
import { router } from 'expo-router'
import { CircleStop, RefreshCw, RotateCcw, X } from 'lucide-react-native'
import { useAction } from '@/core/api'
import { useTheme } from '@/core/theme'
import { Button, Sheet } from '@/core/ui'

/** What can be done to the agent itself; closing asks first (its terminal ends). */
export function AgentActions({ instanceId, petName, open, onClose, onReload }: { instanceId: string; petName: string; open: boolean; onClose: () => void; onReload: () => void }) {
  const interrupt = useAction('agents.interrupt')
  const restart = useAction('agents.restart')
  const close = useAction('agents.close')
  const done = { onSuccess: onClose }
  const { colors } = useTheme()

  const confirmClose = (): void =>
    Alert.alert(`Close ${petName}?`, 'Its terminal ends. Its conversation stays in the CLI history.', [
      // On iOS the action sheet is already gone, so cancelling ends the opening; on Android the sheet stays.
      { text: 'Cancel', style: 'cancel', onPress: Platform.OS === 'ios' ? onClose : undefined },
      { text: 'Close', style: 'destructive', onPress: () => close.mutate({ instanceId }, { onSuccess: () => (onClose(), router.back()) }) }
    ])

  // iOS: the system action sheet, tinted with the theme's accent.
  useEffect(() => {
    if (Platform.OS !== 'ios' || !open) return
    const choices = ['Interrupt what it is doing', 'Restart (resumes its conversation)', 'Redraw the terminal', 'Close agent', 'Cancel']
    ActionSheetIOS.showActionSheetWithOptions(
      { title: petName, options: choices, destructiveButtonIndex: 3, cancelButtonIndex: 4, tintColor: colors.accent, userInterfaceStyle: 'dark' },
      (index) => {
        // The sheet is gone once a choice is made, so the opening ends now (a failure still shows as a notice).
        if (index === 3) return confirmClose()
        if (index === 0) interrupt.mutate({ instanceId })
        else if (index === 1) restart.mutate({ instanceId })
        else if (index === 2) onReload()
        onClose()
      }
    )
    // Shown once per opening; the mutations' identities change every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (Platform.OS === 'ios') return null
  return (
    <Sheet open={open} title={petName} onClose={onClose}>
      <Button label="Interrupt what it is doing" icon={CircleStop} block loading={interrupt.isPending} onPress={() => interrupt.mutate({ instanceId }, done)} />
      <Button label="Restart (resumes its conversation)" icon={RotateCcw} block loading={restart.isPending} onPress={() => restart.mutate({ instanceId }, done)} />
      <Button
        label="Redraw the terminal"
        icon={RefreshCw}
        block
        onPress={() => {
          onReload()
          onClose()
        }}
      />
      <Button
        label="Close agent"
        icon={X}
        variant="danger"
        block
        loading={close.isPending}
        onPress={confirmClose}
      />
    </Sheet>
  )
}
