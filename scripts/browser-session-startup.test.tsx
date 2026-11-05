import assert from 'node:assert/strict'
import { mock, test } from 'node:test'
import React, { act, useState } from 'react'
import { parseHTML } from 'linkedom'
import type { BrowserRecoverySession, BrowserState, BrowserTab } from '../src/features/browser/nativeBrowser'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
const document = window.document
Object.defineProperty(document, 'oninput', { configurable: true, value: null })
const frames = new Map<number, FrameRequestCallback>()
let nextFrame = 0
Object.assign(globalThis, {
  window, document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement,
  MutationObserver: window.MutationObserver, React, IS_REACT_ACT_ENVIRONMENT: true,
  getComputedStyle: () => ({ getPropertyValue: () => '' }),
})
Object.assign(window, {
  innerHeight: 800,
  requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame },
  cancelAnimationFrame: (id: number) => { frames.delete(id) },
})
Object.assign(globalThis, { requestAnimationFrame: window.requestAnimationFrame, cancelAnimationFrame: window.cancelAnimationFrame })
Object.defineProperty(window, 'matchMedia', { value: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) })
const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, String(value)) },
  removeItem: (key: string) => { storage.delete(key) },
} })

function deferred() {
  let resolve!: () => void
  let reject!: (error: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
type Gate = ReturnType<typeof deferred>
type Bounds = { visible: boolean; top: number; bottom: number }
type OpenCall = Bounds & { url: string; recoverySession?: BrowserRecoverySession }
const blank = (): BrowserState => ({ url: null, back: false, forward: false, desktop: false })
const listeners = new Map<string, (event: any) => void>()
const gates = new Set<Gate>()
let current = blank()
let tabList: BrowserTab[] = []
let openGate: Gate | null = null
let navigationGate: Gate | null = null
let stateGate: Gate | null = null
let tabsGate: Gate | null = null
let boundsGate: Gate | null = null
let stateReads = 0
let tabsReads = 0
let nativeGeneration = 0
let readyCalls = 0
let fixture = 0
const opens: OpenCall[] = []
const navigations: string[] = []
const bounds: Bounds[] = []
const EXTERNAL_URL = 'https://example.com/external'
const URL = 'https://example.com/initial'
const recoverySession: BrowserRecoverySession = {
  activeIndex: 0,
  tabs: [{ url: URL, title: 'Recovered example', desktop: false }],
}
const RECOVERY_ERROR = '网页进程已恢复，请重新加载此页'
const emitNavigation = () => listeners.get('navigation')?.({ ...current, phase: 'state' })

// Keep the workspace, command queue, local restoration and native bounds effect real.
// Only bridge completion times and the unrelated video decoder are substituted.
const native = {
  addListener: async (name: string, callback: (event: any) => void) => {
    listeners.set(name, callback)
    return { remove: async () => { if (listeners.get(name) === callback) listeners.delete(name) } }
  },
  open: async (args: OpenCall) => {
    opens.push(args)
    const generation = nativeGeneration
    const recovery = args.recoverySession
    const selected = recovery?.tabs[recovery.activeIndex]
    current = { ...blank(), url: selected?.url ?? args.url, title: selected?.title ?? 'Example',
      tabId: 1, loading: !recovery, progress: 8, error: recovery ? RECOVERY_ERROR : null }
    tabList = [{ index: 0, id: 1, title: current.title!, url: current.url!, active: true,
      loading: current.loading, error: current.error ?? undefined }]
    // Native navigation can arrive before the open promise acknowledges the host.
    emitNavigation()
    const gate = openGate
    if (gate) await gate.promise
    if (generation !== nativeGeneration) return
  },
  navigate: async ({ action, url }: { action: string; url: string }) => {
    assert.equal(action, 'url')
    navigations.push(url)
    current = { ...current, url, loading: true, error: null }
    tabList = tabList.map(tab => ({ ...tab, url, loading: true, error: undefined }))
    emitNavigation()
    const gate = navigationGate
    if (gate) await gate.promise
  },
  state: async () => {
    stateReads++
    const value = { ...current }
    const gate = stateGate
    if (gate) await gate.promise
    return value
  },
  tabs: async () => {
    tabsReads++
    const value = tabList.map(tab => ({ ...tab }))
    const gate = tabsGate
    if (gate) await gate.promise
    return { tabs: value }
  },
  setBounds: async (value: Bounds) => {
    bounds.push(value)
    const gate = boundsGate
    if (gate) await gate.promise
  },
  close: async () => {
    nativeGeneration++
    current = blank()
    tabList = []
    listeners.get('closed')?.({})
  },
  getBrowserContext: async () => ({ privateMode: false, privacyCapabilities: { privateMode: true, clearSiteData: true } }),
  clearFind: async () => {},
  updateScripts: async () => {},
  cancelImageRequests: async () => {},
}
mock.module('@capacitor/core', { namedExports: {
  WebPlugin: class {}, CapacitorHttp: {}, Capacitor: { getPlatform: () => 'android', isNativePlatform: () => true },
  SystemBars: { setStyle: async () => {} }, SystemBarsStyle: { Light: 'LIGHT', Dark: 'DARK' },
  registerPlugin: () => native,
} })
mock.module('../src/components/InkVideoPlayer.tsx', { namedExports: {
  InkVideoPlayer: () => <div data-test-player/>,
} })
const { createRoot } = await import('react-dom/client')
const { StartupReadinessProvider, StartupPending } = await import('../src/components/StartupReadiness')
const { openBrowserWithUrl } = await import('../src/features/browser/browserOpen')
const { BrowserWorkspace } = await import('../src/features/browser/BrowserWorkspace')
const { dismissTopHardwareBackLayer } = await import('../src/lib/hardwareBackStack')
const root = createRoot(document.getElementById('root')!)

function Harness({ initialUrl, recovery, pendingLaunch = false }: { initialUrl?: string; recovery?: BrowserRecoverySession; pendingLaunch?: boolean }) {
  const [open, setOpen] = useState(true)
  const [selectedUrl, setSelectedUrl] = useState(initialUrl)
  const [launchPending, setLaunchPending] = useState(pendingLaunch)
  return <StartupReadinessProvider onReady={() => { readyCalls++ }}>
    <StartupPending pending={launchPending}>{null}</StartupPending>
    <button data-cancel onClick={() => setOpen(false)}>Cancel selected surface</button>
    <button data-launch onClick={() => {
      openBrowserWithUrl(EXTERNAL_URL)
      setSelectedUrl(EXTERNAL_URL)
      setLaunchPending(false)
    }}>Resolve external launch URL</button>
    {open ? <BrowserWorkspace initialUrl={selectedUrl} recoverySession={recovery} onExit={() => setOpen(false)}/>
      : <main data-home>有所闻</main>}
  </StartupReadinessProvider>
}

function hold() {
  const gate = deferred()
  gates.add(gate)
  return gate
}
async function release(gate: Gate) {
  await act(async () => { gate.resolve() })
}
async function paint(count = 2) {
  for (let index = 0; index < count; index++) {
    await act(async () => {
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach(callback => callback(index * 16))
    })
  }
}
async function mount(options: { initialUrl?: string; recovery?: BrowserRecoverySession; strict?: boolean; privateMode?: boolean; incognitoMode?: boolean; pendingLaunch?: boolean } = {}) {
  await act(async () => { root.render(null) })
  await act(async () => { gates.forEach(gate => gate.resolve()) })
  gates.clear()
  frames.clear()
  storage.clear()
  if (options.privateMode) storage.set('newsnook:browser:preferences:v1', JSON.stringify({ privateMode: true }))
  if (options.incognitoMode) storage.set('newsnook:browser:preferences:v1', JSON.stringify({ incognitoMode: true }))
  current = blank()
  tabList = []
  stateReads = tabsReads = readyCalls = 0
  opens.length = navigations.length = bounds.length = 0
  openGate = hold()
  navigationGate = hold()
  stateGate = hold()
  tabsGate = hold()
  boundsGate = hold()
  const content = <Harness key={++fixture} initialUrl={options.initialUrl} recovery={options.recovery} pendingLaunch={options.pendingLaunch}/>
  await act(async () => { root.render(options.strict ? <React.StrictMode>{content}</React.StrictMode> : content) })
}
async function finishLocalInitialization() {
  await release(openGate!)
  await release(stateGate!)
  await release(tabsGate!)
  await release(boundsGate!)
  await paint()
}
async function closeWorkspace() {
  await act(async () => { assert.equal(dismissTopHardwareBackLayer(), true) })
  assert.ok(document.querySelector('[data-home]'), 'closing the selected workspace returns home')
}

try {
  await test('real initial URL waits for open, state, tabs and visible bounds, but never network loading', async () => {
    await mount({ initialUrl: URL, strict: true })
    assert.equal(opens.length, 1, 'StrictMode starts the current native operation once')
    assert.equal(current.loading, true, 'early native navigation has already arrived')
    await paint()
    assert.equal(readyCalls, 0, 'an early navigation event cannot complete native open')

    await release(openGate!)
    assert.equal(stateReads, 1)
    assert.equal(tabsReads, 1)
    await paint()
    assert.equal(readyCalls, 0, 'both local session reads are still pending')
    await release(stateGate!)
    await paint()
    assert.equal(readyCalls, 0, 'tabs must arrive before the selected browser is usable')
    await release(tabsGate!)
    assert.ok(bounds.some(value => value.visible), 'the selected native surface was requested visible')
    await paint()
    assert.equal(readyCalls, 0, 'visible native bounds still await local acknowledgement')

    await release(boundsGate!)
    assert.ok(document.querySelector('[role="progressbar"]'), 'network loading continues after local initialization')
    await paint()
    assert.equal(readyCalls, 1, 'local native initialization permits the first rendered frame')
    await act(async () => { emitNavigation() })
    await paint()
    assert.equal(readyCalls, 1, 'later navigation cannot repeat initial readiness')
  })

  await test('initial URL identity shares address normalization for bare hosts, case and default ports', async () => {
    for (const [initialUrl, normalizedUrl] of [
      ['https://example.com', 'https://example.com/'],
      ['https://EXAMPLE.com:443', 'https://example.com/'],
      ['HTTP://EXAMPLE.COM:80', 'http://example.com/'],
    ]) {
      await mount({ initialUrl, strict: true })
      assert.equal(opens[0]?.url, normalizedUrl, 'the native request uses the existing address resolver')
      await paint()
      assert.equal(readyCalls, 0, 'normalization must preserve the pending native initialization gate')
      await finishLocalInitialization()
      assert.equal(readyCalls, 1, `the normalized local session must complete startup for ${initialUrl}`)
      assert.equal(current.loading, true, 'a normalized entry still does not wait for the network')
    }
  })

  await test('recovered workspace waits for native restoration and renders its reload error without a network wait', async () => {
    await mount({ recovery: recoverySession, strict: true })
    assert.equal(opens.length, 1)
    assert.equal(opens[0].recoverySession, recoverySession)
    await paint()
    assert.equal(readyCalls, 0, 'restored metadata alone does not acknowledge native restoration')
    await release(openGate!)
    await release(stateGate!)
    await paint()
    assert.equal(readyCalls, 0, 'the recovered tab list remains pending')
    await release(tabsGate!)
    await release(boundsGate!)
    assert.ok(document.body.textContent?.includes(RECOVERY_ERROR))
    await paint()
    assert.equal(readyCalls, 1, 'the restored reload screen is a usable local result')
  })

  await test('a late external launch URL replaces completed recovery before global startup readiness', async () => {
    await mount({ recovery: recoverySession, pendingLaunch: true })
    await finishLocalInitialization()
    assert.equal(readyCalls, 0, 'the native launch URL lookup still blocks global startup')
    stateGate = hold()
    tabsGate = hold()
    boundsGate = hold()
    await act(async () => {
      document.querySelector('[data-launch]')!.dispatchEvent(new window.Event('click', { bubbles: true }))
    })
    assert.equal(opens.length, 1, 'the selected URL reuses the restored native session')
    assert.deepEqual(navigations, [EXTERNAL_URL])
    await paint()
    assert.equal(readyCalls, 0, 'the selected entry changes in the same commit that releases the launch lookup')
    await release(stateGate!)
    await release(tabsGate!)
    await release(boundsGate!)
    await paint()
    assert.equal(readyCalls, 0, 'early navigation snapshots cannot acknowledge the selected URL command')
    await release(navigationGate!)
    await paint()
    assert.equal(readyCalls, 1)
    assert.ok(document.querySelector('[role="progressbar"]'), 'the new URL is still loading from the network')
  })

  await test('a superseded initial refresh waits for the latest local snapshot or its explicit failure', async () => {
    for (const failLatest of [false, true]) {
      await mount({ initialUrl: URL })
      await release(openGate!)
      const staleState = stateGate!
      const staleTabs = tabsGate!
      stateGate = hold()
      tabsGate = hold()
      await act(async () => { emitNavigation() })
      assert.equal(stateReads, 2)
      assert.equal(tabsReads, 2)
      await release(staleState)
      await release(staleTabs)
      await paint()
      assert.equal(readyCalls, 0, 'the completed command cannot accept its superseded snapshot')
      if (failLatest) {
        await act(async () => { stateGate!.reject(new Error('Latest local snapshot failed')) })
        assert.ok(document.body.textContent?.includes('Latest local snapshot failed'))
      } else {
        await release(stateGate!)
        await paint()
        assert.equal(readyCalls, 0)
        await release(tabsGate!)
        await release(boundsGate!)
      }
      await paint()
      assert.equal(readyCalls, 1)
    }
  })

  for (const failure of ['open', 'state', 'tabs', 'bounds'] as const) {
    await test('native ' + failure + ' failure releases the startup gate with an explicit error', async () => {
      await mount({ initialUrl: URL })
      if (failure !== 'open') await release(openGate!)
      if (failure === 'bounds') {
        await release(stateGate!)
        await release(tabsGate!)
      }
      const failed = { open: openGate, state: stateGate, tabs: tabsGate, bounds: boundsGate }[failure]!
      await act(async () => { failed.reject(new Error('Local ' + failure + ' failed')) })
      await paint()
      assert.equal(readyCalls, 1, 'a failed bridge call cannot leave startup permanently blocked')
      assert.ok(document.body.textContent?.includes('Local ' + failure + ' failed'), 'the local failure is visible')
    })
  }

  await test('closing while native open is pending releases the selected workspace and ignores the late acknowledgement', async () => {
    await mount({ initialUrl: URL })
    await paint()
    assert.equal(readyCalls, 0)
    await closeWorkspace()
    await paint()
    assert.equal(readyCalls, 1)
    await finishLocalInitialization()
    assert.equal(readyCalls, 1)
    assert.ok(!document.querySelector('[aria-label="NewsNook 网页浏览器"]'), 'late open cannot restore a closed workspace')
  })

  await test('unmounting a pending workspace removes its blocker and late local reads cannot affect its replacement', async () => {
    await mount({ initialUrl: URL })
    await release(openGate!)
    const oldState = stateGate!
    const oldTabs = tabsGate!
    await act(async () => {
      document.querySelector('[data-cancel]')!.dispatchEvent(new window.Event('click', { bubbles: true }))
    })
    await paint()
    assert.equal(readyCalls, 1, 'the selected home screen can become ready')
    await release(oldState)
    await release(oldTabs)
    await paint()
    assert.equal(readyCalls, 1)
    assert.ok(document.querySelector('[data-home]'))
  })

  await test('plain start page and ignored private recovery do not wait for a native session', async () => {
    for (const options of [{}, { recovery: recoverySession, privateMode: true }, { recovery: recoverySession, incognitoMode: true }]) {
      await mount(options)
      await paint()
      assert.equal(opens.length, 0)
      assert.equal(readyCalls, 1, 'there is no selected native initialization to await')
    }
  })

  await test('incognito page completions never persist browsing or search history', async () => {
    await mount({initialUrl: URL, incognitoMode: true})
    await finishLocalInitialization()
    await act(async () => {
      listeners.get('navigation')?.({...current, phase: 'end', loading: false, recordHistory: true})
    })
    assert.equal(storage.has('newsnook:browser:history:v1'), false)
  })
} finally {
  await act(async () => { root.unmount() })
  await act(async () => { gates.forEach(gate => gate.resolve()) })
  mock.restoreAll()
}
