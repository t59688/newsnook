import { Suspense, lazy, useEffect, useLayoutEffect, useState } from 'react'
import { StartupPending } from '../../components/StartupReadiness'
import { useStartupBlocker } from '../../hooks/useStartupReadiness'
import { takeBrowserRecoverySession, type BrowserRecoverySession } from './nativeBrowser'
import { BROWSER_OPEN_EVENT, type BrowserOpenDetail } from './browserOpen'

// Do not parse browser chrome, agents and video playback code on the home screen.
// Startup recovery still runs in this lightweight launcher and opens the workspace
// as soon as its native state is available.
const BrowserWorkspace = lazy(() =>
  Promise.all([
    import('./BrowserWorkspace'),
    import('./browser.css'),
    import('./agent/agent.css'),
  ]).then(([module]) => ({ default: module.BrowserWorkspace })),
)

// Shared only within this JavaScript lifetime. A recreated Activity gets a new read.
let startupRecovery: Promise<BrowserRecoverySession | null> | null = null
function readStartupRecovery() {
  if (!startupRecovery) startupRecovery = takeBrowserRecoverySession().catch(() => null)
  return startupRecovery
}

interface WorkspaceState {
  recoverySession?: BrowserRecoverySession
  initialUrl?: string
  returnToReader?: boolean
}

/** Native WebView site viewport and a themed NewsNook browser chrome. */
export function BrowserLauncher({ onVisibilityChange }: { onVisibilityChange?: (visible: boolean) => void }) {
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [startupRecoveryResolved, setStartupRecoveryResolved] = useState(false)
  useStartupBlocker(!startupRecoveryResolved)
  const visible = Boolean(workspace)
  useLayoutEffect(() => {
    onVisibilityChange?.(visible)
  }, [onVisibilityChange, visible])
  useEffect(() => {
    let live = true
    const enter = (event: Event) => {
      // A user's new entry supersedes any delayed startup recovery result.
      startupRecovery = Promise.resolve(null)
      const detail = 'detail' in event ? (event as CustomEvent<BrowserOpenDetail>).detail : undefined
      const initialUrl = detail?.url && /^https?:\/\//i.test(detail.url) ? detail.url : undefined
      const returnToReader = Boolean(initialUrl && detail?.returnToReader)
      setWorkspace(current => {
        if (!current) return { initialUrl, returnToReader }
        return initialUrl ? { ...current, initialUrl } : current
      })
      setStartupRecoveryResolved(true)
    }
    window.addEventListener(BROWSER_OPEN_EVENT, enter)
    const request = readStartupRecovery()
    void request.then(snapshot => {
      if (!live || startupRecovery !== request) return
      // Consume only from a live effect, so StrictMode's trial mount cannot lose it.
      startupRecovery = Promise.resolve(null)
      if (snapshot) setWorkspace({ recoverySession: snapshot })
      setStartupRecoveryResolved(true)
    })
    return () => {
      live = false
      window.removeEventListener(BROWSER_OPEN_EVENT, enter)
    }
  }, [])
  return workspace ? (
    <Suspense fallback={<StartupPending><div role="status" className="fixed inset-0 z-50 bg-ink text-paper flex items-center justify-center">正在打开浏览器…</div></StartupPending>}>
      <BrowserWorkspace
        initialUrl={workspace.initialUrl}
        returnToReader={workspace.returnToReader}
        recoverySession={workspace.recoverySession}
        onExit={() => {
          startupRecovery = Promise.resolve(null)
          setWorkspace(null)
        }}
      />
    </Suspense>
  ) : null
}

