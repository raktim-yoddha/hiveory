import { CloudOff, RefreshCw } from 'lucide-react-native'
import { useConnection } from './api'
import { Banner } from './ui'

/** Says when the active computer cannot be reached; tap to try again now. */
export function ConnectionBanner() {
  const { computer, status, retry } = useConnection()
  if (!computer || status === 'online') return null
  return status === 'offline' ? (
    <Banner icon={CloudOff} tone="danger" message={`Can't reach ${computer.name}. Is Tailscale on, and the computer awake?`} action="Retry" onPress={retry} />
  ) : (
    <Banner icon={RefreshCw} message={`Connecting to ${computer.name}…`} />
  )
}
