import { Alert } from 'react-native'
import { router } from 'expo-router'
import { CircleStop, RefreshCw, RotateCcw, X } from 'lucide-react-native'
import { useAction } from '@/core/api'
import { Button, Sheet } from '@/core/ui'

/** What can be done to the agent itself; closing asks first (its terminal ends). */
export function AgentActions({ instanceId, petName, open, onClose, onReload }: { instanceId: string; petName: string; open: boolean; onClose: () => void; onReload: () => void }) {
  const interrupt = useAction('agents.interrupt')
  const restart = useAction('agents.restart')
  const close = useAction('agents.close')
  const done = { onSuccess: onClose }

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
        onPress={() =>
          Alert.alert(`Close ${petName}?`, 'Its terminal ends. Its conversation stays in the CLI history.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Close', style: 'destructive', onPress: () => close.mutate({ instanceId }, { onSuccess: () => (onClose(), router.back()) }) }
          ])
        }
      />
    </Sheet>
  )
}
