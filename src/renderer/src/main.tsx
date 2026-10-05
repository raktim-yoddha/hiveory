import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/base.css'
import { AppShell } from './features/shell/AppShell'
import { useBrowser } from './stores/browser'
import { installEventBridge } from './stores/bridge'
import { applyLook } from './features/shell/appearance'
import { useConnections } from './stores/connections'
import { useApp, useClis, useSettings } from './stores/data'
import { reportError } from './stores/notices'
import { useVoice } from './features/queen/voice'

// Last-resort guards: stray async failures become notices instead of silent breakage.
window.addEventListener('unhandledrejection', (event) => reportError(event.reason))
window.addEventListener('error', (event) => {
  if (event.error) reportError(event.error)
})

function App() {
  const settings = useSettings((s) => s.settings)
  const { theme, wallpaper, surfaceOpacity, wallpaperBlur, wallpaperDim } = settings
  useEffect(() => {
    const uninstall = installEventBridge()
    void useApp.getState().load()
    void useClis.getState().load()
    void useSettings.getState().load()
    void useBrowser.getState().load()
    // Queen Bee's speech packs: the mic button and hold-to-talk need to know what's installed.
    void useVoice.getState().load()
    void useConnections.getState().load()
    return uninstall
  }, [])
  useEffect(() => {
    applyLook({ theme, wallpaper, surfaceOpacity, wallpaperBlur, wallpaperDim })
  }, [theme, wallpaper, surfaceOpacity, wallpaperBlur, wallpaperDim])
  return <AppShell />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
