import { useLocalSearchParams } from 'expo-router'
import { RouteErrorBoundary } from '@/core/boundary'
import { PairScreen, type PairParams } from '@/features/onboarding'

export { RouteErrorBoundary as ErrorBoundary }

/** Also opened by hiveory://pair?a=…&p=…&c=… links (the QR on the computer). */
export default function PairRoute() {
  const params = useLocalSearchParams<Record<keyof PairParams, string>>()
  return <PairScreen params={params} />
}
