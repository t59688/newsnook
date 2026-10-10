import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mock } from 'node:test'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'

// Exercise the real player; replace only the browser decoder/HLS engine boundary.
class Decoder {
  static Events = { MANIFEST_PARSED: 'manifest', ERROR: 'error' }
  static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' }
  static ErrorDetails = { MANIFEST_LOAD_ERROR: 'manifestLoadError', MANIFEST_LOAD_TIMEOUT: 'manifestLoadTimeOut' }
  static isSupported() { return true }
  static instances: Decoder[] = []
  config: Record<string, unknown>
  starts = 0
  mediaRecoveries = 0
  stopped = false
  destroyed = false
  listeners = new Map<string, (...args: any[]) => void>()
  constructor(config: Record<string, unknown>) { this.config = config; Decoder.instances.push(this) }
  loadSource() {}
  attachMedia() {}
  on(event: string, callback: (...args: any[]) => void) { this.listeners.set(event, callback) }
  startLoad() { this.starts++ }
  recoverMediaError() { this.mediaRecoveries++ }
  stopLoad() { this.stopped = true }
  destroy() { this.destroyed = true }
  fatal(type = 'networkError') { this.listeners.get('error')?.('error', { fatal: true, type }) }
}
Object.assign(globalThis, { testHlsDecoder: Decoder })
registerHooks({ resolve(specifier, context, next) {
  return specifier === 'hls.js'
    ? { url: 'data:text/javascript,export default globalThis.testHlsDecoder', shortCircuit: true }
    : next(specifier, context)
} })
const { window } = parseHTML('<!doctype html><html><body></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} disconnect() {} },
})
window.getComputedStyle = (() => ({ overflow: 'visible', overflowY: 'visible' })) as typeof getComputedStyle
const createElement = document.createElement.bind(document)
document.createElement = ((name: string, options?: ElementCreationOptions) => {
  const element = createElement(name, options)
  if (name === 'video') Object.assign(element, {
    currentTime: 0, duration: 120, paused: true, readyState: 1, ended: false,
    buffered: { length: 0 }, playbackRate: 1, defaultPlaybackRate: 1,
    canPlayType: () => '',
    load() { this.currentTime = 0; this.paused = true },
    async play() { this.paused = false; this.dispatchEvent(new window.Event('play')); this.dispatchEvent(new window.Event('playing')) },
    pause() { this.paused = true; this.dispatchEvent(new window.Event('pause')) },
  })
  return element
}) as typeof document.createElement
const { Capacitor, registerPlugin } = await import('@capacitor/core')
let nativeMode = false
let prepares = 0
let renewals = 0
let releases = 0
let renewalGate: Promise<void> | undefined
let prepareGate: Promise<void> | undefined
Capacitor.isNativePlatform = () => nativeMode
Capacitor.getPlatform = () => nativeMode ? 'android' : 'web'
registerPlugin('MediaSniffer', { web: () => nativeMock, android: () => nativeMock })
const nativeMock = {
  async preparePlayback() { prepares++; await prepareGate },
  async renewPlayback() { renewals++; await renewalGate },
  async releasePlayback() { releases++ },
}
const { createRoot } = await import('react-dom/client')
const { InkVideoPlayer } = await import('../src/components/InkVideoPlayer')
const src = 'https://example.com/video.m3u8'
const engine = () => Decoder.instances.at(-1)!
const video = () => document.querySelector('video')!
async function fatal(type?: string) { await act(async () => engine().fatal(type)) }
async function tick(ms: number) { await act(async () => mock.timers.tick(ms)) }
type Render = (element: React.ReactNode) => Promise<void>
const cases: Array<[string, (render: Render) => Promise<void>]> = [
  ['duplicate fatal errors during the last retry stay single-flight', async render => {
    await render(<InkVideoPlayer src={src} />)
    await fatal(); await tick(500)
    await fatal(); await tick(1000)
    await fatal(); await fatal()
    assert.equal(engine().stopped, false, 'an already scheduled last retry must remain in flight')
    await tick(2000)
    assert.equal(engine().starts, 3)
    await fatal()
    assert.equal(engine().stopped, true)
    await tick(10000)
    assert.equal(engine().starts, 3, 'terminal failure must never restart loading')
  }],
  ['unsupported fatal cancels pending recovery immediately', async render => {
    await render(<InkVideoPlayer src={src} />)
    await fatal(); await fatal('muxError')
    assert.equal(engine().stopped, true, 'unrecoverable fatal must terminate without waiting for another retry')
    await tick(10000)
    assert.equal(engine().starts, 0)
    assert.ok(document.body.textContent?.includes('视频流加载失败'))
  }],
  ['unmount cancels a pending recovery', async render => {
    await render(<InkVideoPlayer src={src} />)
    const previous = engine()
    await fatal(); await render(<span>Closed</span>); await tick(10000)
    assert.equal(previous.starts, 0)
    assert.equal(previous.destroyed, true)
  }],
  ['video decoder failure also cancels an already scheduled HLS recovery', async render => {
    await render(<InkVideoPlayer src={src} />)
    await fatal()
    await act(async () => video().dispatchEvent(new window.Event('error')))
    await tick(10000)
    assert.equal(engine().starts, 0, 'fatal decoder UI must not leave an HLS restart timer running')
    assert.equal(engine().stopped, true)
  }],
  ['canplay does not repeatedly replenish the recovery budget', async render => {
    await render(<InkVideoPlayer src={src} />)
    for (const delay of [500, 1000, 2000]) {
      await fatal(); await tick(delay)
      await act(async () => video().dispatchEvent(new window.Event('canplay')))
    }
    await fatal()
    assert.equal(engine().stopped, true)
  }],
  ['media failures use decoder recovery rather than network restart', async render => {
    await render(<InkVideoPlayer src={src} />)
    await fatal('mediaError'); await tick(500)
    assert.equal(engine().mediaRecoveries, 1)
    assert.equal(engine().starts, 0)
  }],
  ['seeking and brief playback do not replenish the recovery budget', async render => {
    await render(<InkVideoPlayer src={src} />)
    for (const delay of [500, 1000, 2000]) { await fatal(); await tick(delay) }
    const v = video()
    await act(async () => { await v.play(); v.dispatchEvent(new window.Event('timeupdate')) })
    for (let second = 1; second <= 9; second++) {
      await tick(1000)
      await act(async () => { v.currentTime = second; v.dispatchEvent(new window.Event('timeupdate')) })
    }
    await act(async () => {
      v.dispatchEvent(new window.Event('seeking'))
      v.currentTime = 70
      v.dispatchEvent(new window.Event('seeked'))
      v.dispatchEvent(new window.Event('timeupdate'))
    })
    await tick(1000)
    await act(async () => { v.currentTime = 71; v.dispatchEvent(new window.Event('timeupdate')) })
    await fatal()
    assert.equal(engine().stopped, true, 'time skipped with seek cannot finish a stable playback window')
  }],
  ['ten seconds of advancing playback replenishes recovery budget', async render => {
    await render(<InkVideoPlayer src={src} />)
    await fatal(); await tick(500)
    await fatal(); await tick(1000)
    await fatal(); await tick(2000)
    const v = video()
    await act(async () => { await v.play(); v.dispatchEvent(new window.Event('timeupdate')) })
    for (let second = 1; second <= 10; second++) {
      await tick(1000)
      await act(async () => { v.currentTime = second; v.dispatchEvent(new window.Event('timeupdate')) })
    }
    await fatal(); await tick(500)
    assert.equal(engine().starts, 4, 'stable advancing playback must allow a later independent recovery')
    assert.equal(engine().stopped, false)
  }],
  ['manual retry reloads current resource and preserves pause, position and rate', async render => {
    let refreshes = 0
    await render(<InkVideoPlayer src={src} onRefreshSource={() => { refreshes++ }} />)
    const v = video()
    await act(async () => v.dispatchEvent(new window.Event('canplay')))
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="播放速度"]')!.click())
    const fastRate = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '1.5x')
    assert.ok(fastRate)
    await act(async () => fastRate.click())
    assert.equal(v.playbackRate, 1.5)
    await act(async () => { v.currentTime = 42; await v.play(); v.pause() })
    await fatal('muxError'); await tick(10000)
    const previous = engine()
    const retry = document.querySelector<HTMLButtonElement>('button[aria-label="重试当前视频"]')
    assert.ok(retry, 'fatal UI must offer retry even when no source discovery owner is available')
    await act(async () => retry.click())
    await act(async () => v.dispatchEvent(new window.Event('loadedmetadata')))
    assert.notEqual(engine(), previous)
    assert.equal(previous.destroyed, true)
    assert.equal(v.currentTime, 42)
    assert.equal(v.paused, true)
    assert.equal(v.playbackRate, 1.5)
    assert.equal(refreshes, 0, 'retrying current media must not invoke source discovery')
  }],
  ['native HLS keeps default XHR with a session marker while Web retains hotlink loader', async render => {
    nativeMode = true
    await render(<InkVideoPlayer src={src} sourcePage="https://page.example/watch" requestHeaders={{ Cookie: 'private' }} />)
    const config = engine().config
    assert.equal(config.loader, undefined, 'Android authentication must flow through native WebView XHR interception')
    const headers = new Map<string, string>()
    assert.equal(typeof config.xhrSetup, 'function')
    ;(config.xhrSetup as (xhr: XMLHttpRequest) => void)({ setRequestHeader: (name, value) => headers.set(name, value) } as XMLHttpRequest)
    assert.ok(headers.get('X-NewsNook-Playback-Session')?.startsWith('play-'))
    assert.equal(headers.has('Cookie'), false)
    await render(<span>Closed</span>)
    nativeMode = false
    await render(<InkVideoPlayer src={src} sourcePage="https://page.example/watch" />)
    assert.equal(typeof engine().config.loader, 'function')
    assert.equal(engine().config.xhrSetup, undefined)
  }],
  ['standalone manual retry preserves active play intent without a discovery callback', async render => {
    await render(<InkVideoPlayer src={src} />)
    const v = video()
    await act(async () => { v.currentTime = 30; await v.play() })
    await fatal('muxError')
    const retry = document.querySelector<HTMLButtonElement>('button[aria-label="重试当前视频"]')
    assert.ok(retry)
    await act(async () => retry.click())
    await act(async () => v.dispatchEvent(new window.Event('loadedmetadata')))
    assert.equal(v.currentTime, 30)
    assert.equal(v.paused, false)
  }],
  ['visibility renews existing native session without registering credentials again', async render => {
    nativeMode = true
    await render(<InkVideoPlayer src={src} />)
    const beforePrepares = prepares
    const beforeRenewals = renewals
    await act(async () => document.dispatchEvent(new window.Event('visibilitychange')))
    assert.equal(renewals, beforeRenewals + 1)
    assert.equal(prepares, beforePrepares, 'lease renewal must not re-register captured authentication')
  }],
  ['late native lease renewal cannot reattach a closed session', async render => {
    nativeMode = true
    await render(<InkVideoPlayer src={src} />)
    let resolve!: () => void
    renewalGate = new Promise(done => { resolve = done })
    const beforePrepares = prepares
    const beforeRenewals = renewals
    const beforeReleases = releases
    await act(async () => document.dispatchEvent(new window.Event('visibilitychange')))
    await act(async () => document.dispatchEvent(new window.Event('visibilitychange')))
    assert.equal(renewals, beforeRenewals + 1, 'overlapping visibility events cannot start concurrent renewals')
    await render(<span>Closed</span>)
    await act(async () => resolve())
    assert.equal(prepares, beforePrepares)
    assert.ok(releases > beforeReleases)
    assert.equal(document.querySelector('video'), null)
    renewalGate = undefined
  }],
  ['rejected origin refresh after unmount still releases the prepared native session', async render => {
    nativeMode = true
    await render(<InkVideoPlayer src={src} />)
    let reject!: (error: Error) => void
    prepareGate = new Promise((_resolve, fail) => { reject = fail })
    await render(<InkVideoPlayer src={src} extraUrls={['https://cdn.example/segment.ts']} />)
    const beforeReleases = releases
    await render(<span>Closed</span>)
    await act(async () => reject(new Error('synthetic bridge failure')))
    assert.ok(releases > beforeReleases, 'rejected pending refresh cannot retain native credentials after unmount')
    prepareGate = undefined
  }],
]
const failed: string[] = []
for (const [name, test] of cases) {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  nativeMode = false
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    await test(async element => { await act(async () => root.render(element)) })
    console.log(`PASS ${name}`)
  } catch (error) {
    failed.push(name)
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`)
  } finally {
    renewalGate = undefined
    prepareGate = undefined
    await act(async () => root.unmount())
    mock.timers.reset()
    host.remove()
  }
}
assert.equal(failed.length, 0, `${failed.length} HLS recovery regressions failed`)
