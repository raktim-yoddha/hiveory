import { createElement, forwardRef, useCallback, useImperativeHandle, useLayoutEffect, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { Loading } from '../ui'
import type { TerminalHandle } from './TerminalView'
import { TERMINAL_HTML } from './terminal-html.generated'
import { useTerminalFeed } from './useTerminalFeed'

export type { TerminalHandle } from './TerminalView'

/** The web build's terminal: the same page as on phones, in an iframe instead of a WebView. */
export const TerminalView = forwardRef<TerminalHandle, { instanceId: string }>(function TerminalView({ instanceId }, ref) {
  const frame = useRef<HTMLIFrameElement | null>(null)
  const send = useCallback((message: object) => frame.current?.contentWindow?.postMessage(JSON.stringify(message), '*'), [])
  const feed = useTerminalFeed(instanceId, send)
  const { onPageMessage } = feed
  useImperativeHandle(ref, () => ({ reload: feed.reload }), [feed.reload])

  // A layout effect listens before the iframe can run: its "ready" would otherwise come first and be missed.
  useLayoutEffect(() => {
    const onMessage = (e: MessageEvent): void => {
      if (e.source === frame.current?.contentWindow && typeof e.data === 'string') onPageMessage(e.data)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [onPageMessage])

  return (
    <View style={[styles.fill, { backgroundColor: feed.background }]}>
      {createElement('iframe', { ref: frame, srcDoc: TERMINAL_HTML, title: 'Terminal output', style: { border: 0, flex: 1, width: '100%', height: '100%', background: feed.background } })}
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
