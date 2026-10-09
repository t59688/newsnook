import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'
import type { MediaResourceDescriptor } from '../src/features/mediaSniffer/types'

const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {
  window, document: window.document, Node: window.Node, Element: window.Element,
  HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true,
  ResizeObserver: class { observe() {} disconnect() {} },
})
window.getComputedStyle = (() => ({ overflow: 'visible', overflowY: 'visible' })) as typeof getComputedStyle
const createElement = document.createElement.bind(document)
let loads = 0
document.createElement = ((name: string, options?: ElementCreationOptions) => {
  const element = createElement(name, options)
  if (name === 'video') {
    Object.assign(element, {
      currentTime: 0, duration: 120, paused: true, buffered: { length: 0 },
      canPlayType: () => '',
      load() { loads++; this.currentTime = 0; this.paused = true },
      async play() { this.paused = false; this.dispatchEvent(new window.Event('play')) },
      pause() { this.paused = true },
    })
  }
  return element
}) as typeof document.createElement

const { createRoot } = await import('react-dom/client')
const { InkVideoPlayer } = await import('../src/components/InkVideoPlayer')
const root = createRoot(document.getElementById('root')!)
const src = 'https://example.com/video.mp4'
let firstErrors = 0
let latestErrors = 0
const originalError = () => { firstErrors++ }
const latestError = () => { latestErrors++ }
const related = ['https://example.com/segment.mp4']
async function render(props: Partial<React.ComponentProps<typeof InkVideoPlayer>> = {}) {
  await act(async () => {
    root.render(<InkVideoPlayer src={src} extraUrls={related} onPlaybackError={originalError} {...props} />)
  })
}
try {
  await render()
  const video = document.querySelector('video')!
  await act(async () => {
    video.currentTime = 42
    await video.play()
    video.dispatchEvent(new window.Event('timeupdate'))
  })
  const initialLoads = loads
  await render({ title: 'Unrelated parent update' })
  assert.equal(loads, initialLoads, 'parent rerender must not reload a playing media source')
  assert.equal(video.currentTime, 42)
  assert.equal(video.paused, false)
  await act(async () => {
    video.dispatchEvent(new window.Event('waiting'))
    video.dispatchEvent(new window.Event('canplay'))
  })
  assert.equal(loads, initialLoads, 'buffering must not recreate the media engine')
  assert.equal(video.currentTime, 42)
  assert.equal(video.paused, false)

  await render({ extraUrls: [...related], requestHeaders: {}, onPlaybackError: latestError })
  assert.equal(loads, initialLoads, 'equivalent sniff metadata and a new callback must preserve playback')
  await act(async () => { video.dispatchEvent(new window.Event('error')) })
  assert.equal(firstErrors, 0, 'error handling must not retain a stale callback')
  assert.equal(latestErrors, 1)

  await render({ requestHeaders: { Referer: 'https://example.com/page' } })
  assert.ok(loads > initialLoads, 'changed authentication context must reinitialize playback')
  const headers = { Referer: 'https://example.com/page', Accept: '*/*' }
  const urls = [...related, 'https://example.com/alternate.mp4']
  await render({ requestHeaders: headers, extraUrls: urls })
  const orderedLoads = loads
  await render({ requestHeaders: { Accept: headers.Accept, Referer: headers.Referer }, extraUrls: [...urls].reverse().concat(related) })
  assert.equal(loads, orderedLoads, 'header ordering and duplicate/reordered related URLs must not reload media')
  const contextLoads = loads
  await render({ src: 'https://example.com/next.mp4' })
  assert.ok(loads > contextLoads, 'selecting a different source must initialize it')

  const resources: MediaResourceDescriptor[] = [src, 'https://example.com/alternate.mp4'].map((url) => ({
    id: url, url, type: 'progressive', pageUrl: '', score: 0,
    videoTracks: [], audioTracks: [], subtitles: [], drm: false, drmKeySystems: [],
  }))
  for (const mediaPageHost of [false, true]) {
    await render({ resources, mediaPageHost })
    await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label^="选择视频资源"]')!.click() })
    await act(async () => {
      const rows = document.querySelectorAll<HTMLButtonElement>('li button')
      rows[1].click()
    })
    const selectedVideo = document.querySelector('video')!
    await act(async () => { selectedVideo.currentTime = 24; await selectedVideo.play() })
    const selectedLoads = loads
    await render({ resources: structuredClone(resources), mediaPageHost })
    assert.ok(document.querySelector('video') === selectedVideo, 'sniff metadata updates must preserve the selected player')
    assert.equal(loads, selectedLoads, 'sniff metadata updates must not reset a selected resource')
    assert.equal(selectedVideo.currentTime, 24)
    assert.equal(selectedVideo.paused, false)
    if (mediaPageHost) assert.ok(document.querySelector('[data-media-resource-screen]'), 'metadata update must not dismiss the media page')
    // A new article/source still resets the explicit selection.
    await render({ src: 'https://example.com/reset.mp4' })
    assert.equal(document.querySelector('[data-media-resource-screen]'), null)
  }
} finally {
  await act(async () => root.unmount())
}
console.log('ink-video-lifecycle: ok')

