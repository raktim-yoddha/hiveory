import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/base.css'
import { AppShell } from './features/shell/AppShell'
import { useBrowser } from './stores/browser'
import { installEventBridge } from './stores/bridge'
import { refreshTerminalTheme } from './features/terminal/terminal-registry'
import { useApp, useClis, useSettings } from './stores/data'
import { reportError } from './stores/notices'

// Last-resort guards: stray async failures become notices instead of silent breakage.
window.addEventListener('unhandledrejection', (event) => reportError(event.reason))
window.addEventListener('error', (event) => {
  if (event.error) reportError(event.error)
})

function App() {
  const theme = useSettings((s) => s.settings.theme)
  useEffect(() => {
    const uninstall = installEventBridge()
    void useApp.getState().load()
    void useClis.getState().load()
    void useSettings.getState().load()
    void useBrowser.getState().load()
    return uninstall
  }, [])
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    refreshTerminalTheme()
  }, [theme])
  return <AppShell />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
