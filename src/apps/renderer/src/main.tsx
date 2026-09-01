import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HiveoryShell } from './app/shell/HiveoryShell'
import './app/styles/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><HiveoryShell /></StrictMode>,
)
