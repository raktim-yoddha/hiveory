import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AgenticSuperAppShell } from './agentic-super-app-shell'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><AgenticSuperAppShell /></StrictMode>,
)
