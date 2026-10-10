import assert from 'node:assert/strict'
import React, { act, useMemo, useRef } from 'react'
import { parseHTML } from 'linkedom'
import type { MediaObservation, MediaResourceDescriptor } from '../src/features/mediaSniffer/types'

// Real React components; only the browser media decoder/native bridge are fakes.
const { window } = parseHTML('<!doctype html><html><body></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
  React, IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 0),
  cancelAnimationFrame: clearTimeout,
})
window.getComputedStyle = (() => ({ overflow: 'visible', overflowY: 'visible' })) as typeof getComputedStyle
const createElement = document.createElement.bind(document)
let loads = 0
let plays = 0
document.createElement = ((name: string, options?: ElementCreationOptions) => {
  const element = createElement(name, options)
  if (name === 'video') {
    Object.assign(element, {
      currentTime: 0, duration: 120, paused: true, readyState: 1, ended: false,
      buffered: { length: 0 }, playbackRate: 1, defaultPlaybackRate: 1,
      canPlayType: () => '',
      load() { loads++; this.currentTime = 0; this.paused = true },
      async play() { plays++; this.paused = false; this.dispatchEvent(new window.Event('play')); this.dispatchEvent(new window.Event('playing')) },
      pause() { this.paused = true; this.dispatchEvent(new window.Event('pause')) },
    })
  }
  return element
}) as typeof document.createElement

const { Capacitor, registerPlugin } = await import('@capacitor/core')
let nativeMode = false
Capacitor.isNativePlatform = () => nativeMode
Capacitor.getPlatform = () => nativeMode ? 'android' : 'web'
const listeners = new Set<(event: { sessionId: string; observation: MediaObservation }) => void>()
let liveSessionId = ''
let prepares = 0
let preparedOptions: { origins?: string[] } | undefined
let prepareGate: Promise<void> | undefined
const nativeMock = {
  async addListener(_name: string, fn: (event: { sessionId: string; observation: MediaObservation }) => void) {
    listeners.add(fn)
    return { remove: async () => { listeners.delete(fn) } }
  },
  async startLiveSession(options: { sessionId: string }) { liveSessionId = options.sessionId },
  async stopLiveSession() {}, async setLiveSessionBounds() {}, async setLiveSessionVisible() {},
  async preparePlayback(options: { origins?: string[] }) { prepares++; preparedOptions = options; await prepareGate },
  async getStreamProxyPort() { return { port: 9999 } },
}
registerPlugin('MediaSniffer', { web: () => nativeMock, android: () => nativeMock })
const { createRoot } = await import('react-dom/client')
const { InkVideoPlayer } = await import('../src/components/InkVideoPlayer')
const { OriginPlayerSurface } = await import('../src/components/OriginPlayerSurface')
const { InlineArticleVideos } = await import('../src/components/InlineArticleVideos')
const src = 'https://example.com/video.mp4'
const extra = ['https://example.com/segment.mp4']
const resource = (url: string, id = url): MediaResourceDescriptor => ({
  id, url, type: 'progressive', pageUrl: '', score: 100,
  videoTracks: [], audioTracks: [], subtitles: [], drm: false, drmKeySystems: [],
})
function player() { const video = document.querySelector('video'); assert.ok(video); return video }
async function playAt(time = 42) {
  const video = player()
  await act(async () => { video.currentTime = time; await video.play(); video.dispatchEvent(new window.Event('timeupdate')) })
  return video
}
function steady(video: HTMLVideoElement, initialLoads: number, time = 42) {
  assert.ok(player() === video, 'the active video element must remain mounted')
  assert.equal(loads, initialLoads, 'observation updates must not reload the active media')
  assert.equal(video.currentTime, time, 'playback position must survive')
  assert.equal(video.paused, false, 'play intent must survive')
}
async function click(selector: string, index = 0) {
  const button = document.querySelectorAll<HTMLButtonElement>(selector)[index]
  assert.ok(button, `missing button: ${selector}[${index}]`)
  await act(async () => button.click())
}
async function emit(observation: Partial<MediaObservation> & { url: string }) {
  await act(async () => {
    for (const fn of listeners) fn({ sessionId: liveSessionId, observation: {
      pageUrl: 'https://example.com/watch/1', source: 'network', mimeType: 'video/mp4',
      hasAudio: true, hasVideo: true, ...observation,
    } })
  })
}
function InlineFixture({ title, html }: { title: string; html: string }) {
  const body = useRef<HTMLElement>(null)
  const markup = useMemo(() => ({ __html: html }), [html])
  return <><article ref={body} dangerouslySetInnerHTML={markup} /><InlineArticleVideos rootRef={body} html={html} enabled fallbackTitle={title} /></>
}

type Render = (element: React.ReactNode) => Promise<void>
const cases: Array<[string, (render: Render) => Promise<void>]> = [
  ['additional sniff URLs must not restart playback', async render => {
    await render(<InkVideoPlayer src={src} extraUrls={extra} />)
    const v = await playAt(); const count = loads
    await render(<InkVideoPlayer src={src} extraUrls={[...extra, 'https://other-cdn.example/new.mp4']} />)
    steady(v, count)
  }],
  ['inferred and explicit progressive format are the same engine', async render => {
    await render(<InkVideoPlayer src={src} />)
    const v = await playAt(); const count = loads
    await render(<InkVideoPlayer src={src} format="progressive" />)
    steady(v, count)
  }],
  ['HTTP header name casing must not restart playback', async render => {
    await render(<InkVideoPlayer src={src} requestHeaders={{ Referer: 'https://example.com/' }} />)
    const v = await playAt(); const count = loads
    await render(<InkVideoPlayer src={src} requestHeaders={{ referer: 'https://example.com/' }} />)
    steady(v, count)
  }],
  ['selecting the currently playing resource is idempotent', async render => {
    await render(<InkVideoPlayer src={src} mediaPageHost={false} resources={[resource(src, 'sniff-id')]} />)
    const v = await playAt(); const count = loads
    await click('button[aria-label^="选择视频资源"]'); await click('li button')
    steady(v, count)
  }],
  ['standalone media page receives new resources without closing', async render => {
    const initial = [resource(src), resource('https://example.com/second.mp4')]
    await render(<InkVideoPlayer src={src} resources={initial} extraUrls={extra} />)
    await click('button[aria-label^="选择视频资源"]'); await click('li button', 1)
    const v = await playAt(); const count = loads
    const updated = [...structuredClone(initial).map((item, index) => ({ ...item, id: `refreshed-${index}` })), resource('https://example.com/third.mp4')]
    await render(<InkVideoPlayer src={src} resources={updated} extraUrls={[...extra, 'https://example.com/third.mp4']} />)
    steady(v, count)
    assert.equal(document.querySelectorAll('[data-media-resource-screen] li button').length, 3, 'resource list must not freeze when the media page opens')
    assert.equal(document.querySelectorAll('[data-media-resource-screen] li button[aria-current="true"]').length, 1, 'changing observation IDs must not erase the active resource marker')
  }],
  ['native progressive recovery resumes at the prior position', async render => {
    nativeMode = true
    await render(<InkVideoPlayer src={src} />)
    const v = await playAt()
    await act(async () => { v.dispatchEvent(new window.Event('error')) })
    await act(async () => { v.dispatchEvent(new window.Event('loadedmetadata')); v.dispatchEvent(new window.Event('canplay')) })
    assert.ok(player() === v)
    assert.equal(v.currentTime, 42, 'a transport recovery is not a new video')
    assert.equal(v.paused, false, 'resume the prior play intent after recovery')
  }],
  ['live candidate ranking cannot replace the chosen video', async render => {
    nativeMode = true
    await render(<OriginPlayerSurface pageUrl="https://example.com/watch/1" title="One" />)
    await emit({ url: src })
    await click('button[aria-label="关闭原站并切换播放器"]')
    const v = await playAt(); const count = loads
    await emit({ url: 'https://example.com/higher-score.mp4', source: 'dom', width: 1920, height: 1080 })
    steady(v, count)
  }],
  ['failed origin handoff keeps the error and manual retry visible', async render => {
    nativeMode = true
    await render(<OriginPlayerSurface pageUrl="https://example.com/watch/1" title="One" />)
    await emit({ url: src })
    await click('button[aria-label="关闭原站并切换播放器"]')
    const v = player()
    let reject!: (error: Error) => void
    prepareGate = new Promise((_resolve, fail) => { reject = fail })
    await act(async () => v.dispatchEvent(new window.Event('error')))
    await act(async () => reject(new Error('synthetic transport failure')))
    prepareGate = undefined
    assert.ok(document.querySelector('video'), 'failure must not silently return to origin')
    assert.ok(document.querySelector('button[aria-label="重试当前视频"]'))
    assert.ok(document.body.textContent?.includes('视频源暂时无法播放'))
  }],
  ['late handoff cannot reopen a different origin session', async render => {
    nativeMode = true
    await render(<OriginPlayerSurface pageUrl="https://example.com/watch/1" title="One" />)
    await emit({ url: src })
    let release!: () => void
    prepareGate = new Promise(resolve => { release = resolve })
    try {
      await click('button[aria-label="关闭原站并切换播放器"]')
      await render(<OriginPlayerSurface pageUrl="https://example.com/watch/2" title="Two" />)
      await emit({ url: 'https://example.com/two.mp4' })
    } finally {
      prepareGate = undefined
      await act(async () => { release() })
    }
    assert.ok(!document.querySelector('video'), 'stale async handoff must not switch the new page into custom playback')
  }],
  ['new CDN origins update native permissions without a media reload', async render => {
    nativeMode = true
    const headers = { Referer: 'https://example.com/' }
    await render(<InkVideoPlayer src={src} requestHeaders={headers} extraUrls={extra} />)
    const v = await playAt(); const count = loads; const beforePrepares = prepares
    const urls = [...extra, 'https://new-cdn.example/segment.m4s']
    await render(<InkVideoPlayer src={src} requestHeaders={headers} extraUrls={urls} />)
    steady(v, count)
    assert.equal(prepares, beforePrepares + 1)
    assert.ok(preparedOptions?.origins?.includes('https://new-cdn.example'))
    await render(<InkVideoPlayer src={src} requestHeaders={headers} extraUrls={[...urls, 'https://new-cdn.example/another.m4s']} />)
    steady(v, count)
    assert.equal(prepares, beforePrepares + 1, 'same-origin segments do not re-register native contexts')
  }],
  ['authentication reconnect restores playback but respects manual pause', async render => {
    await render(<InkVideoPlayer src={src} requestHeaders={{ Authorization: 'first' }} />)
    const v = await playAt()
    await render(<InkVideoPlayer src={src} requestHeaders={{ Authorization: 'second' }} />)
    await act(async () => { v.dispatchEvent(new window.Event('loadedmetadata')) })
    assert.equal(v.currentTime, 42); assert.equal(v.paused, false)
    await act(async () => v.pause())
    const beforePlays = plays
    await render(<InkVideoPlayer src={src} requestHeaders={{ Authorization: 'third' }} />)
    await act(async () => { v.dispatchEvent(new window.Event('loadedmetadata')) })
    assert.equal(v.currentTime, 42); assert.equal(v.paused, true)
    assert.equal(plays, beforePlays, 'manual pause must never become autoplay')
  }],
  ['native error retries are bounded and respect a paused video', async render => {
    nativeMode = true
    await render(<InkVideoPlayer src={src} />)
    const v = await playAt()
    await act(async () => v.pause())
    const beforePlays = plays
    for (let attempt = 0; attempt < 4; attempt++) {
      await act(async () => { v.dispatchEvent(new window.Event('error')) })
      await act(async () => { v.dispatchEvent(new window.Event('loadedmetadata')) })
    }
    assert.equal(v.currentTime, 42); assert.equal(v.paused, true)
    assert.equal(plays, beforePlays)
    const count = loads
    await act(async () => { v.dispatchEvent(new window.Event('error')) })
    assert.equal(loads, count, 'exhausted recovery cannot loop load() forever')
  }],
  ['late native initialization cannot attach a disposed source', async render => {
    nativeMode = true
    let release!: () => void
    prepareGate = new Promise(resolve => { release = resolve })
    await render(<InkVideoPlayer src={src} />)
    const oldVideo = player()
    await render(<span>Closed</span>)
    const count = loads
    prepareGate = undefined
    await act(async () => release())
    assert.equal(loads, count)
    assert.ok(!oldVideo.getAttribute('src'))
  }],
  ['inline HTML metadata enrichment keeps the existing portal host', async render => {
    const html = `<video src="${src}"></video><p>Body</p>`
    await render(<InlineFixture title="Before" html={html} />)
    const v = await playAt(); const count = loads
    await render(<InlineFixture title="After" html={`<video src="${src}" title="New title"></video><p>Updated body</p>`} />)
    steady(v, count)
    await render(<InlineFixture title="After" html="<p>Video removed</p>" />)
    assert.ok(!document.querySelector('video'), 'genuinely removed videos must release the player')
  }],
  ['slow native recovery remains single-flight despite duplicate errors and readiness events', async render => {
    nativeMode = true
    let errors = 0
    await render(<InkVideoPlayer src={src} onPlaybackError={() => { errors++ }} />)
    const v = await playAt()
    let release!: () => void
    prepareGate = new Promise(resolve => { release = resolve })
    const beforePrepares = prepares
    try {
      await act(async () => { v.dispatchEvent(new window.Event('error')) })
      // The old 2-second suppression timeout must not admit another recovery
      // while preparePlayback has still not resolved.
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 2150)) })
      await act(async () => {
        v.dispatchEvent(new window.Event('canplay'))
        v.dispatchEvent(new window.Event('error'))
        v.dispatchEvent(new window.Event('error'))
      })
      assert.equal(prepares, beforePrepares + 1, 'a pending recovery must not start a second preparePlayback')
      assert.equal(errors, 0, 'duplicate events must not exhaust retries and close a healthy player')
    } finally {
      prepareGate = undefined
      await act(async () => release())
    }
    await act(async () => { v.dispatchEvent(new window.Event('loadedmetadata')) })
    assert.equal(v.currentTime, 42)
    assert.equal(v.paused, false)
  }],
  ['recovery loading keeps the displayed progress until metadata restores it', async render => {
    nativeMode = true
    await render(<InkVideoPlayer src={src} />)
    await act(async () => { player().dispatchEvent(new window.Event('loadedmetadata')) })
    const v = await playAt()
    assert.ok(document.body.textContent?.includes('0:42'), 'precondition: the current time must already be visible')
    await act(async () => { v.dispatchEvent(new window.Event('error')) })
    await act(async () => { v.dispatchEvent(new window.Event('timeupdate')) })
    assert.ok(document.body.textContent?.includes('0:42'), 'temporary source reset must not flash a zero progress label')
    await act(async () => { v.dispatchEvent(new window.Event('loadedmetadata')) })
    assert.equal(v.currentTime, 42)
  }],
  ['manual pause during asynchronous native recovery overrides old play intent', async render => {
    nativeMode = true
    await render(<InkVideoPlayer src={src} />)
    const v = await playAt()
    let release!: () => void
    prepareGate = new Promise(resolve => { release = resolve })
    await act(async () => { v.dispatchEvent(new window.Event('error')) })
    await act(async () => v.pause())
    prepareGate = undefined
    await act(async () => release())
    const beforePlays = plays
    await act(async () => { v.dispatchEvent(new window.Event('loadedmetadata')) })
    assert.equal(v.currentTime, 42)
    assert.equal(v.paused, true, 'a later manual pause must override the recovery checkpoint')
    assert.equal(plays, beforePlays)
  }],
  ['repeated readiness events after recovery cannot undo a manual pause', async render => {
    nativeMode = true
    await render(<InkVideoPlayer src={src} />)
    const v = await playAt()
    await act(async () => { v.dispatchEvent(new window.Event('error')) })
    await act(async () => { v.dispatchEvent(new window.Event('loadedmetadata')) })
    await act(async () => v.pause())
    const beforePlays = plays
    for (const event of ['loadeddata', 'canplay', 'canplay']) {
      await act(async () => { v.dispatchEvent(new window.Event(event)) })
    }
    assert.equal(v.currentTime, 42)
    assert.equal(v.paused, true)
    assert.equal(plays, beforePlays, 'a consumed checkpoint cannot restart a user-paused video')
  }],
  ['inline StrictMode replay keeps a single active portal', async render => {
    const html = `<video src="${src}"></video><p>Body</p>`
    await render(<React.StrictMode><InlineFixture title="Before" html={html} /></React.StrictMode>)
    const v = await playAt(); const count = loads
    await render(<React.StrictMode><InlineFixture title="After" html={html} /></React.StrictMode>)
    steady(v, count)
    assert.equal(document.querySelectorAll('[data-reader-inline-video]').length, 1)
  }],
  ['inline video survives a title-only update', async render => {
    const html = `<video src="${src}"></video><p>Body</p>`
    await render(<InlineFixture title="Before" html={html} />)
    const v = await playAt(); const count = loads
    await render(<InlineFixture title="After" html={html} />)
    steady(v, count)
  }],
]

const failed: string[] = []
for (const [name, test] of cases) {
  const host = document.createElement('div'); document.body.appendChild(host)
  const root = createRoot(host)
  nativeMode = false
  try {
    await test(async element => { await act(async () => root.render(element)) })
    console.log(`PASS ${name}`)
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
    failed.push(name); console.error(`FAIL ${name}: ${reason}`)
  } finally {
    prepareGate = undefined
    await act(async () => root.unmount())
    host.remove()
  }
}
console.log(JSON.stringify({ cases: cases.length, failed, loads, plays, prepares }))
assert.equal(failed.length, 0, `${failed.length} live-update regressions failed`)
