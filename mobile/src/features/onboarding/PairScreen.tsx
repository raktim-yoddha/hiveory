import { useEffect, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { Camera, Keyboard, Link2, QrCode } from 'lucide-react-native'
import { DEFAULT_SERVER_PORT, parsePairingLink } from '@/core/computers'
import { radius, space, useTheme } from '@/core/theme'
import { Button, Card, Loading, Screen, Text, TextField } from '@/core/ui'
import { usePairing } from './usePairing'

export interface PairParams {
  /** From a hiveory://pair link (the QR opened by the phone's camera app). */
  a?: string
  p?: string
  c?: string
  manual?: string
}

/**
 * Connect a computer: scan the QR it shows (or open its link), or type its
 * Tailscale name. Same Tailscale account = no code needed (ADR 0025).
 */
export function PairScreen({ params }: { params: PairParams }) {
  const { colors } = useTheme()
  const { state, pair, reset } = usePairing()
  const [manual, setManual] = useState(params.manual === '1')
  const [address, setAddress] = useState('')
  const [port, setPort] = useState(String(DEFAULT_SERVER_PORT))
  const [code, setCode] = useState('')
  const [permission, requestPermission] = useCameraPermissions()
  const scanned = useRef(false)

  // Opened from a pairing link: pair at once.
  useEffect(() => {
    if (!params.a) return
    const link = parsePairingLink(`hiveory://pair?a=${encodeURIComponent(params.a)}&p=${params.p ?? DEFAULT_SERVER_PORT}${params.c ? `&c=${params.c}` : ''}`)
    if (link) void pair(link)
    // Only for the link the screen was opened with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.a])

  const onScan = ({ data }: { data: string }): void => {
    if (scanned.current) return
    const link = parsePairingLink(data)
    if (!link) return
    scanned.current = true
    void pair(link)
  }

  if (state.step === 'pairing') return <Loading label={`Connecting to ${state.address}…`} />

  if (state.step === 'needs-code') {
    return (
      <Screen>
        <Card>
          <Text variant="lead">Enter the pairing code</Text>
          <Text tone="muted">This phone is on another Tailscale account, so the computer asks for its code: Settings › Remote › Share this computer.</Text>
          <TextField label="Pairing code" value={code} onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} autoCapitalize="characters" mono autoFocus maxLength={8} />
          <Button label="Connect" variant="primary" icon={Link2} disabled={code.length !== 8} onPress={() => void pair({ ...state.target, code })} />
        </Card>
      </Screen>
    )
  }

  const failed = state.step === 'failed' ? state : null
  return (
    <Screen>
      {failed ? (
        <Card tone="waiting">
          <Text variant="lead">{failed.message}</Text>
          {failed.hint ? <Text tone="secondary">{failed.hint}</Text> : null}
          <Button
            label="Try again"
            onPress={() => {
              scanned.current = false
              reset()
            }}
          />
        </Card>
      ) : null}
      {!manual ? (
        <View style={styles.stack}>
          {permission?.granted ? (
            <View style={[styles.camera, { backgroundColor: colors.surfaceInset }]}>
              <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
              <View style={[styles.frame, { borderColor: colors.accent }]} pointerEvents="none" />
            </View>
          ) : (
            <Card>
              <Camera size={24} color={colors.accent} />
              <Text variant="lead">Scan the code on your computer</Text>
              <Text tone="muted">The camera is used only to read the pairing code, never recorded.</Text>
              <Button label={permission?.canAskAgain === false ? 'Allow the camera in Settings' : 'Allow the camera'} variant="primary" onPress={() => void requestPermission()} />
            </Card>
          )}
          <Text tone="muted" variant="label" style={styles.center}>
            On the computer: Settings › Remote › Share this computer › Connect your phone
          </Text>
          <Button label="Enter the address instead" variant="ghost" icon={Keyboard} onPress={() => setManual(true)} />
        </View>
      ) : (
        <Card>
          <TextField label="Computer" placeholder="devbox.tail1234.ts.net or 100.x.y.z" value={address} onChangeText={setAddress} autoCapitalize="none" keyboardType="url" hint="Its Tailscale name or address." />
          <TextField label="Port" value={port} onChangeText={(v) => setPort(v.replace(/\D/g, '').slice(0, 5))} keyboardType="number-pad" />
          <TextField
            label="Pairing code (if asked)"
            value={code}
            onChangeText={(v) => setCode(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))}
            autoCapitalize="characters"
            mono
            hint="Not needed when this phone uses the same Tailscale account."
          />
          <Button
            label="Connect"
            variant="primary"
            icon={Link2}
            disabled={!/^[A-Za-z0-9.:-]{2,253}$/.test(address.trim()) || !Number(port)}
            onPress={() => void pair({ address: address.trim(), port: Number(port), ...(code.length === 8 ? { code } : {}) })}
          />
          <Button label="Scan a code instead" variant="ghost" icon={QrCode} onPress={() => setManual(false)} />
        </Card>
      )}
    </Screen>
  )
}

const styles = StyleSheet.create({
  stack: { gap: space[7] },
  camera: { aspectRatio: 1, borderRadius: radius.lg, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  frame: { width: '62%', aspectRatio: 1, borderWidth: 2, borderRadius: radius.lg },
  center: { textAlign: 'center' }
})
