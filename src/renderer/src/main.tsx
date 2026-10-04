import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import '@fontsource-variable/jetbrains-mono'
import './styles/tokens.css'
import './styles/base.css'
import { AppShell } from './features/shell/AppShell'
import { installEventBridge } from './stores/bridge'
import { useApp, useClis } from './stores/data'
import { reportError } from './stores/notices'

// Last-resort guards: stray async failures become notices instead of silent breakage.
window.addEventListener('unhandledrejection', (event) => reportError(event.reason))
window.addEventListener('error', (event) => {
  if (event.error) reportError(event.error)
})

function App() {
  useEffect(() => {
    const uninstall = installEventBridge()
    void useApp.getState().load()
    void useClis.getState().load()
    return uninstall
  }, [])
  return <AppShell />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
