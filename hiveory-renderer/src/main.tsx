import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HiveoryShell } from './app/HiveoryShell'
import './app/app.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><HiveoryShell /></StrictMode>,
)
