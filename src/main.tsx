import './lib/logger'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
import { BootstrapRoot } from './BootstrapRoot'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BootstrapRoot />
  </StrictMode>,
)
