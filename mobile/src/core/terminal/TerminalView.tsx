import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { WebView } from 'react-native-webview'
import { Loading } from '../ui'
import { TERMINAL_HTML } from './terminal-html.generated'
import { useTerminalFeed } from './useTerminalFeed'

export interface TerminalHandle {
  /** Re-reads the whole screen (after the computer resized it). */
  reload(): void
}

/**
 * A live agent or shell terminal, drawn exactly as on the computer: its own
 * size scaled to the phone's width (pinch to zoom), never resizing the real
 * one. Read-only; typing goes through the screen's own input bar.
 */
export const TerminalView = forwardRef<TerminalHandle, { instanceId: string }>(function TerminalView({ instanceId }, ref) {
  const web = useRef<WebView>(null)
  const send = useCallback((message: object) => web.current?.postMessage(JSON.stringify(message)), [])
  const feed = useTerminalFeed(instanceId, send)
  useImperativeHandle(ref, () => ({ reload: feed.reload }), [feed.reload])

  return (
    <View style={[styles.fill, { backgroundColor: feed.background }]}>
      <WebView
        ref={web}
        source={{ html: TERMINAL_HTML }}
        originWhitelist={['about:*']}
        onMessage={(e) => feed.onPageMessage(e.nativeEvent.data)}
        style={[styles.fill, { backgroundColor: feed.background }]}
        javaScriptEnabled
        scalesPageToFit={false}
        bounces={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
        accessibilityLabel="Terminal output"
      />
      {!feed.loaded ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: feed.background }]}>
          <Loading label="Opening the terminal…" />
        </View>
      ) : null}
    </View>
  )
})

const styles = StyleSheet.create({
  fill: { flex: 1 }
})
