import assert from 'node:assert/strict'
import React, { act, StrictMode } from 'react'
import { parseHTML } from 'linkedom'

const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, MutationObserver: window.MutationObserver,
  React, IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} disconnect() {} },
  requestAnimationFrame: (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 0),
  cancelAnimationFrame: clearTimeout,
})
Object.assign(window, { innerWidth: 390, innerHeight: 844 })
window.getComputedStyle = (() => ({ overflow: 'visible', overflowY: 'visible', getPropertyValue: () => '0px' })) as typeof getComputedStyle
const createElement = document.createElement.bind(document)
let loads = 0
document.createElement = ((name: string, options?: ElementCreationOptions) => {
  const element = createElement(name, options)
  if (name === 'video') Object.assign(element, {
    currentTime: 0, duration: 120, paused: true, readyState: 1, ended: false,
    videoWidth: 1920, videoHeight: 1080, buffered: { length: 0 }, playbackRate: 1, defaultPlaybackRate: 1,
    canPlayType: () => '',
    load() { loads++; this.currentTime = 0; this.paused = true },
    async play() { this.paused = false; this.dispatchEvent(new window.Event('play')); this.dispatchEvent(new window.Event('playing')) },
    pause() { this.paused = true; this.dispatchEvent(new window.Event('pause')) },
  })
  return element
}) as typeof document.createElement

const { createRoot } = await import('react-dom/client')
const { Capacitor, registerPlugin } = await import('@capacitor/core')
let native = false
let releaseEntry: (() => void) | undefined
let entryGate: Promise<void> | undefined
let exitGate: Promise<void> | undefined
const fullCalls: boolean[] = []
const suppressionCalls: boolean[] = []
const orientationCalls: string[] = []
Object.assign(Capacitor, { isNativePlatform: () => native, getPlatform: () => native ? 'android' : 'web', isPluginAvailable: () => native })
const controlsMock = {
  async setVideoFullscreen({ active }: { active: boolean }) { fullCalls.push(active); await (active ? entryGate : exitGate) },
  async lockOrientation({ orientation }: { orientation: string }) { orientationCalls.push(orientation) }, async unlockOrientation() { orientationCalls.push('unlock') }, async clearBrightness() {},
  async getBattery() { return { level: 80, charging: false } },
  async getVolume() { return { value: 1 } }, async getBrightness() { return { value: 1 } },
}
registerPlugin('DeviceMediaControls', { android: () => controlsMock, web: () => controlsMock })
const mediaMock = {
  async preparePlayback() {}, async releasePlayback() {},
  async setLiveSurfaceSuppressed({ suppressed }: { suppressed: boolean }) { suppressionCalls.push(suppressed) },
}
registerPlugin('MediaSniffer', { android: () => mediaMock, web: () => mediaMock })
const appMock = { async addListener() { return { async remove() {} } } }
registerPlugin('App', { android: () => appMock, web: () => appMock })
const { InkVideoPlayer } = await import('../src/components/InkVideoPlayer')
const { FloatingVideoProvider } = await import('../src/features/floatingVideo/FloatingVideoProvider')
const { hardwareBackLayerCount, dismissTopHardwareBackLayer } = await import('../src/lib/hardwareBackStack')
const root = createRoot(document.getElementById('root')!)
let oldErrors = 0
const src = 'https://example.com/floating.mp4'
async function render(show = true, title = '视频标题', extra = false) {
  await act(async () => { root.render(<StrictMode><FloatingVideoProvider>
    {show && <InkVideoPlayer src={src} title={title} onPlaybackError={() => oldErrors++} />}
    {extra && <InkVideoPlayer src="https://example.com/second.mp4" title="第二视频" resources={[{
      id: 'second', url: 'https://example.com/second.mp4', type: 'progressive', pageUrl: '', score: 100,
      videoTracks: [], audioTracks: [], subtitles: [], drm: false, drmKeySystems: [],
    }]} />}
    <button aria-label="页面操作">页面内容</button>
  </FloatingVideoProvider></StrictMode>) })
}
async function click(label: string) {
  const button = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
  assert.ok(button, `missing ${label}`)
  await act(async () => { button.click(); await new Promise(resolve => setTimeout(resolve, 0)) })
}
function video() { const v = document.querySelector('video'); assert.ok(v); return v }
try {
  await render()
  const original = video()
  await act(async () => { original.currentTime = 42; await original.play(); original.dispatchEvent(new window.Event('canplay')); original.playbackRate = 1.5; original.dispatchEvent(new window.Event('ratechange')) })
  const count = loads
  await click('悬浮播放')
  assert.ok(document.querySelector('[data-floating-video-window]'))
  assert.equal(video(), original)
  assert.equal(original.currentTime, 42)
  assert.equal(original.playbackRate, 1.5)
  assert.equal(loads, count, 'presentation must not reload media')
  assert.equal(hardwareBackLayerCount(), 0, 'a floating window must not consume page back')
  const floating = document.querySelector<HTMLElement>('[data-floating-video-window]')!
  const drag = floating.querySelector<HTMLElement>('[aria-label="移动悬浮窗口"]')!
  const left = Number.parseFloat(floating.style.left)
  await act(async () => { const event = new window.Event('keydown', { bubbles: true }); Object.assign(event, { key: 'ArrowLeft' }); drag.dispatchEvent(event); await new Promise(resolve => setTimeout(resolve, 5)) })
  assert.equal(Number.parseFloat(floating.style.left), left - 8)
  const handle = floating.querySelector<HTMLElement>('[aria-label="调整悬浮窗口大小"]')!
  const width = Number.parseFloat(floating.style.width)
  await act(async () => { const event = new window.Event('keydown', { bubbles: true }); Object.assign(event, { key: 'ArrowRight' }); handle.dispatchEvent(event); await new Promise(resolve => setTimeout(resolve, 5)) })
  assert.equal(Number.parseFloat(floating.style.width), width + 8)
  const pointer = async (target: HTMLElement, type: string, id: number, x: number, y: number, pointerType = 'mouse') => {
    await act(async () => { const event = new window.Event(type, { bubbles: true }); Object.assign(event, { pointerId: id, button: 0, pointerType, clientX: x, clientY: y }); target.dispatchEvent(event); await new Promise(resolve => setTimeout(resolve, 5)) })
  }
  const draggedLeft = Number.parseFloat(floating.style.left)
  await pointer(drag, 'pointerdown', 1, 100, 100)
  await pointer(drag, 'pointermove', 1, 85, 80)
  await pointer(drag, 'pointerup', 1, 85, 80)
  assert.equal(Number.parseFloat(floating.style.left), draggedLeft - 15)
  await pointer(drag, 'pointerdown', 2, 100, 100)
  await pointer(drag, 'pointercancel', 2, 100, 100)
  await pointer(drag, 'pointermove', 2, 180, 100)
  assert.equal(Number.parseFloat(floating.style.left), draggedLeft - 15, 'cancelled drag must not keep moving')
  const resizedWidth = Number.parseFloat(floating.style.width)
  await pointer(handle, 'pointerdown', 3, 100, 100)
  await pointer(handle, 'pointermove', 3, 130, 100)
  await pointer(handle, 'pointerup', 3, 130, 100)
  assert.equal(Number.parseFloat(floating.style.width), resizedWidth + 30)
  const pinchedWidth = Number.parseFloat(floating.style.width)
  await pointer(floating, 'pointerdown', 4, 100, 100, 'touch')
  await pointer(floating, 'pointerdown', 5, 200, 100, 'touch')
  await pointer(floating, 'pointermove', 5, 220, 100, 'touch')
  await pointer(floating, 'pointerup', 4, 100, 100, 'touch')
  await pointer(floating, 'pointerup', 5, 220, 100, 'touch')
  assert.equal(Number.parseFloat(floating.style.width), pinchedWidth * 1.2, 'two fingers resize the window')
  const savedWidth = floating.style.width
  await render(true, '更新标题')
  assert.equal(video(), original)
  await click('恢复播放页')
  assert.equal(document.querySelector('[data-floating-video-window]'), null)
  assert.equal(video(), original)
  await click('悬浮播放')
  assert.equal(document.querySelector<HTMLElement>('[data-floating-video-window]')!.style.width, savedWidth, 'window dimensions survive restore/float')
  await render(false)
  assert.equal(video(), original, 'page unmount must preserve the global runtime')
  assert.equal(original.paused, false)
  assert.equal(original.currentTime, 42)
  await click('恢复播放页')
  assert.ok(document.querySelector('[data-video-session-page]'))
  assert.equal(video(), original)
  await act(async () => { assert.equal(dismissTopHardwareBackLayer(), true); await Promise.resolve() })
  assert.ok(document.querySelector('[data-floating-video-window]'))
  await click('全屏')
  assert.ok(document.querySelector('[data-video-fullscreen="true"]'))
  const savedPosition = { left: floating.style.left, top: floating.style.top }
  await act(async () => { Object.assign(window, { innerWidth: 844, innerHeight: 390 }); window.dispatchEvent(new window.Event('resize')); await new Promise(resolve => setTimeout(resolve, 5)) })
  await act(async () => { assert.equal(dismissTopHardwareBackLayer(), true); await new Promise(resolve => setTimeout(resolve, 0)) })
  await act(async () => { Object.assign(window, { innerWidth: 390, innerHeight: 844 }); window.dispatchEvent(new window.Event('resize')); await new Promise(resolve => setTimeout(resolve, 5)) })
  assert.equal(floating.style.left, savedPosition.left, 'fullscreen orientation must preserve window x')
  assert.equal(floating.style.top, savedPosition.top, 'fullscreen orientation must preserve window y')
  assert.equal(document.querySelector('[data-video-fullscreen="true"]'), null)
  assert.equal(video(), original)
  await render(false, '', true)
  assert.equal(document.querySelector('button[aria-label^="选择视频资源"]'), null, 'another inline player must not overlay a floating session with its FAB')
  const second = [...document.querySelectorAll('video')].find(v => v !== original)!
  await act(async () => second.play())
  assert.equal(original.paused, true, 'another explicit playback must pause the floating session')
  await act(async () => original.play())
  await act(async () => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new window.Event('visibilitychange')) })
  assert.equal(original.paused, true)
  await act(async () => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new window.Event('visibilitychange')) })
  assert.equal(original.paused, true, 'foreground must not resume automatically')
  await act(async () => original.play())
  assert.equal(original.paused, true, 'a WebView resume play event must not undo background pause')
  await act(async () => { document.querySelector<HTMLButtonElement>('[data-floating-video-window] button[aria-label="播放"]')!.click(); await Promise.resolve() })
  assert.equal(original.paused, false, 'the user can explicitly resume after background pause')
  await act(async () => original.dispatchEvent(new window.Event('error')))
  assert.equal(oldErrors, 0, 'detached callbacks must not call the dead page')
  await click('关闭悬浮播放')
  assert.equal(original.isConnected, false)
  assert.equal(original.paused, true)
  assert.equal(document.querySelector('[data-floating-video-window]'), null)
  await render(false)
  assert.equal(document.querySelector('video'), null)
  assert.equal(hardwareBackLayerCount(), 0)
  await render(true)
  await act(async () => video().dispatchEvent(new window.Event('canplay')))
  await click('悬浮播放')
  const browserHost = document.querySelector<HTMLElement>('[data-video-session-host]')!
  const browserParent = browserHost.parentNode
  const browserRoot = browserHost.querySelector<HTMLDivElement>('[data-video-compact]')!
  let fullscreenElement: Element | null = null
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement })
  browserRoot.requestFullscreen = async () => { fullscreenElement = browserRoot; document.dispatchEvent(new window.Event('fullscreenchange')) }
  document.exitFullscreen = async () => { fullscreenElement = null; document.dispatchEvent(new window.Event('fullscreenchange')) }
  await click('全屏')
  assert.ok(browserHost.parentNode === browserParent, 'DOM fullscreen must not reparent its ancestor and trigger browser exit')
  assert.notEqual(browserHost.parentElement?.parentElement?.getAttribute('aria-hidden'), 'true', 'the retained fullscreen ancestor must remain accessible')
  await act(async () => { dismissTopHardwareBackLayer(); await new Promise(resolve => setTimeout(resolve, 0)) })
  await click('关闭悬浮播放')
  await render(false)
  native = true
  await render(true)
  await click('悬浮播放')
  assert.equal(suppressionCalls.at(-1), true, 'global video must suppress the native origin surface')
  await act(async () => { video().dispatchEvent(new window.Event('loadedmetadata')); video().dispatchEvent(new window.Event('canplay')) })
  entryGate = new Promise<void>(resolve => { releaseEntry = resolve })
  // Do not await the blocked native transition: close while entry is in flight.
  await act(async () => { document.querySelector<HTMLButtonElement>('[data-floating-video-window] button[aria-label="全屏"]')!.click() })
  await click('关闭悬浮播放')
  await act(async () => { releaseEntry?.(); await new Promise(resolve => setTimeout(resolve, 5)) })
  assert.equal(document.querySelector('[data-video-fullscreen="true"]'), null)
  assert.equal(document.querySelector('video'), null)
  assert.equal(fullCalls.at(-1), false, 'late native entry must be undone after close')
  assert.equal(suppressionCalls.at(-1), false)
  await render(false)
  await render(true)
  const rotations = orientationCalls.length
  await act(async () => { video().dispatchEvent(new window.Event('loadedmetadata')); video().dispatchEvent(new window.Event('canplay')) })
  entryGate = new Promise<void>(resolve => { releaseEntry = resolve })
  await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="切换横竖屏"]')!.click() })
  await render(false)
  await act(async () => { releaseEntry?.(); await new Promise(resolve => setTimeout(resolve, 5)) })
  assert.equal(orientationCalls.length, rotations, 'closing during rotation entry must not acquire a late orientation lock')
  entryGate = undefined
  await render(true)
  await act(async () => { video().dispatchEvent(new window.Event('loadedmetadata')); video().dispatchEvent(new window.Event('canplay')) })
  await click('全屏')
  let releaseExit: (() => void) | undefined
  exitGate = new Promise<void>(resolve => { releaseExit = resolve })
  await render(false, '', true)
  await act(async () => { video().dispatchEvent(new window.Event('loadedmetadata')); video().dispatchEvent(new window.Event('canplay')) })
  const beforeNewEntry = fullCalls.length
  await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="全屏"]')!.click() })
  assert.equal(fullCalls.length, beforeNewEntry, 'the new native entry must await the old session teardown')
  await act(async () => { releaseExit?.(); await new Promise(resolve => setTimeout(resolve, 5)) })
  assert.equal(fullCalls.at(-1), true, 'late old cleanup must not clear the new fullscreen state')
  exitGate = undefined
  await render(false)
  native = false
  await render(false, '', true)
  await act(async () => video().dispatchEvent(new window.Event('canplay')))
  const resourceVideo = video()
  const resourceLoads = loads
  await click('选择视频资源，共 1 个')
  await act(async () => document.querySelector<HTMLButtonElement>('li button')!.click())
  assert.ok(document.querySelector('[data-video-session-page]'))
  assert.ok(video() === resourceVideo, 'opening the current resource page must preserve its runtime')
  assert.equal(loads, resourceLoads)
  await render(false)
  assert.ok(video() === resourceVideo, 'resource page survives its parent slot unmount')
} finally { await act(async () => root.unmount()) }
console.log('floating-video-lifecycle: ok')
