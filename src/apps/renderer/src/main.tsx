import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HiveoryShell } from './app/shell/HiveoryShell'
import './app/styles/app.css'
import '@hiveory/premium-theme-style'
import './app/styles/design-system.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><HiveoryShell /></StrictMode>,
)
