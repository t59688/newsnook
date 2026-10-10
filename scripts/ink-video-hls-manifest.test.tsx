import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { mock } from 'node:test'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
import type { HlsConfig, LoaderCallbacks, LoaderConfiguration, LoaderContext, LoaderStats } from 'hls.js'

const { window } = parseHTML('<!doctype html><html><body></body></html>')
Object.assign(globalThis, {
  window, self: window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} disconnect() {} },
})
Object.assign(window, { location: { href: 'https://app.example/' } })
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

// Use the real HLS playlist/stream/error controllers. Only networking and MSE
// attachment are replaced; startLoad/loadSource keep their actual implementations.
const { default: Hls } = await import('../node_modules/hls.js/dist/hls.mjs')
class ManifestNetwork {
  static requests: ManifestNetwork[] = []
  stats: LoaderStats = {
    aborted: false, loaded: 0, total: 0, retry: 0, chunkCount: 0, bwEstimate: 0,
    loading: { start: 1, first: 0, end: 0 }, parsing: { start: 0, end: 0 }, buffering: { start: 0, first: 0, end: 0 },
  }
  context!: LoaderContext
  callbacks!: LoaderCallbacks<LoaderContext>
  load(context: LoaderContext, _config: LoaderConfiguration, callbacks: LoaderCallbacks<LoaderContext>) {
    this.context = context; this.callbacks = callbacks; ManifestNetwork.requests.push(this)
  }
  abort() { this.stats.aborted = true }
  destroy() { this.abort() }
  fail(timeout: boolean) {
    if (timeout) this.callbacks.onTimeout(this.stats, this.context, null)
    else this.callbacks.onError({ code: 503, text: 'Synthetic failure' }, this.context, null, this.stats)
  }
  succeed() {
    const data = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXT-X-MEDIA-SEQUENCE:0\n#EXTINF:6,\nsegment.ts\n#EXT-X-ENDLIST\n'
    this.callbacks.onSuccess({ url: this.context.url, data, code: 200 }, this.stats, this.context, null)
  }
}
class NetworkHls extends Hls {
  static isSupported() { return true }
  static instance: NetworkHls
  constructor(config: Partial<HlsConfig>) {
    super({ ...config, pLoader: ManifestNetwork, enableWorker: false, autoStartLoad: false,
      manifestLoadPolicy: { default: { maxTimeToFirstByteMs: 20000, maxLoadTimeMs: 20000, timeoutRetry: null, errorRetry: null } },
    })
    NetworkHls.instance = this
  }
  // The test has no MSE decoder; real HLS network controllers can run unattached.
  override attachMedia() {}
}
Object.assign(globalThis, { manifestTestHls: NetworkHls })
registerHooks({ resolve(specifier, context, next) {
  return specifier === 'hls.js'
    ? { url: 'data:text/javascript,export default globalThis.manifestTestHls', shortCircuit: true }
    : next(specifier, context)
} })
const { Capacitor, registerPlugin } = await import('@capacitor/core')
Capacitor.isNativePlatform = () => true
Capacitor.getPlatform = () => 'android'
let preparations = 0
const nativeMock = { async preparePlayback() { preparations++ }, async releasePlayback() {}, async renewPlayback() {} }
registerPlugin('MediaSniffer', { web: () => nativeMock, android: () => nativeMock })
const { createRoot } = await import('react-dom/client')
const { InkVideoPlayer } = await import('../src/components/InkVideoPlayer')
const src = 'https://media.example/manifest.m3u8'
const failed: string[] = []
for (const scenario of ['http', 'timeout', 'resume-playing', 'resume-paused']) {
  const timeout = scenario === 'timeout'
  const shouldSucceed = scenario.startsWith('resume-')
  const name = `real HLS manifest ${scenario}`
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  ManifestNetwork.requests = []
  mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  try {
    await act(async () => root.render(<InkVideoPlayer src={src} requestHeaders={{ Referer: 'https://page.example/' }} />))
    assert.equal(ManifestNetwork.requests.length, 1)
    assert.equal(NetworkHls.instance.levels.length, 0, 'precondition: initial manifest has never succeeded')
    const video = document.querySelector('video')!
    if (shouldSucceed) {
      await act(async () => video.dispatchEvent(new window.Event('loadedmetadata')))
      await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="播放速度"]')!.click())
      const fastRate = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '1.5x')!
      await act(async () => fastRate.click())
      await act(async () => { video.currentTime = 42; await video.play(); if (scenario === 'resume-paused') video.pause() })
    }
    const beforePrepares = preparations
    await act(async () => ManifestNetwork.requests[0].fail(timeout))
    await act(async () => mock.timers.tick(500))
    assert.equal(ManifestNetwork.requests.length, 2, 'initial manifest recovery must issue another real playlist request')
    assert.equal(ManifestNetwork.requests[1].context.url, src)
    assert.equal(preparations, beforePrepares, 'manifest reload must retain the existing native session')
    if (shouldSucceed) {
      await act(async () => {
        video.currentTime = 0; video.pause()
        ManifestNetwork.requests[1].succeed()
        video.dispatchEvent(new window.Event('loadedmetadata'))
      })
      assert.ok(NetworkHls.instance.levels.length > 0, 'the real playlist parser must accept the retried response')
      assert.equal(video.currentTime, 42)
      assert.equal(video.playbackRate, 1.5)
      assert.equal(video.paused, scenario === 'resume-paused')
      assert.equal(preparations, beforePrepares)
    } else {
      for (const [index, delay] of [[1, 1000], [2, 2000], [3, 0]]) {
        await act(async () => ManifestNetwork.requests[index].fail(timeout))
        await act(async () => mock.timers.tick(delay))
      }
      assert.equal(ManifestNetwork.requests.length, 4, 'the initial attempt plus three retries is bounded')
      assert.ok(document.querySelector('button[aria-label="重试当前视频"]'), 'exhaustion must expose manual retry')
      await act(async () => mock.timers.tick(10000))
      assert.equal(ManifestNetwork.requests.length, 4)
    }
    console.log(`PASS ${name}`)
  } catch (error) {
    failed.push(name)
    console.error(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await act(async () => root.unmount())
    mock.timers.reset(); host.remove()
  }
}
assert.equal(failed.length, 0, `${failed.length} real HLS manifest regressions failed`)
