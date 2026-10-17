import './lib/logger'
import { StrictMode, Suspense, lazy, createElement } from 'react'
import { createRoot } from 'react-dom/client'

import './index.css'
// Select the private shell before importing ordinary bootstrap/account modules.
// Native getBrowserContext still verifies the activity; the fragment grants no privacy capability.
const rootView = lazy(() => window.location.hash === '#private-browser'
  ? import('./features/browser/PrivateBrowserRoot').then(module => ({default: module.PrivateBrowserRoot}))
  : import('./BootstrapRoot').then(module => ({default: module.BootstrapRoot})))

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={null}>{createElement(rootView)}</Suspense>
  </StrictMode>,
)
