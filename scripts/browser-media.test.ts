import assert from 'node:assert/strict'
import {
  reduceBrowserMedia,
  browserMediaResources,
  observationKey,
  browserResourceTitle,
} from '../src/features/browser/browserMedia'

let tabs = new Map()
const obs = (url: string, pageUrl = 'https://example.com/watch') => ({
  source: 'network' as const, url, pageUrl, mimeType: 'video/mp4',
  mediaKind: 'video' as const, timestamp: Date.now(),
})

tabs = reduceBrowserMedia(tabs, { tabId: 1, type: 'page', pageUrl: 'https://example.com/watch' })
tabs = reduceBrowserMedia(tabs, { tabId: 1, type: 'observation', observation: obs('https://media.example.com/clip.mp4') })
assert.equal(tabs.get(1)?.observations.length, 1)
assert.equal(browserMediaResources(tabs.get(1)!.observations).length, 1)
assert.equal(browserResourceTitle(browserMediaResources(tabs.get(1)!.observations)[0]), '视频文件')
tabs = reduceBrowserMedia(tabs, { tabId: 1, type: 'observation', observation: obs('https://media.example.com/clip.mp4') })
assert.equal(tabs.get(1)?.observations.length, 1, 'duplicate media should be de-duplicated')

tabs = reduceBrowserMedia(tabs, { tabId: 2, type: 'page', pageUrl: 'https://news.example.org/' })
assert.equal(browserMediaResources(tabs.get(2)!.observations).length, 0, 'other tab is isolated')

tabs = reduceBrowserMedia(tabs, { tabId: 1, type: 'page', pageUrl: 'https://example.com/elsewhere' })
assert.equal(tabs.get(1)?.observations.length, 0, 'full navigation resets media')
tabs = reduceBrowserMedia(tabs, { tabId: 1, type: 'observation', observation: obs('https://media.example.com/clip.mp4') })
assert.equal(tabs.get(1)?.observations.length, 0, 'stale previous-page event rejected')

tabs = reduceBrowserMedia(tabs, { tabId: 2, type: 'observation', observation: obs('https://cdn.example.com/list.m3u8', 'https://news.example.org/') })
assert.equal(browserMediaResources(tabs.get(2)!.observations).length, 1, 'playlist admitted')
tabs = reduceBrowserMedia(tabs, { tabId: 2, type: 'observation', observation: {
  ...obs('https://media.example.com/drm.mp4', 'https://news.example.org/'), drmKeySystem: 'com.widevine.alpha',
} })
assert.ok(browserMediaResources(tabs.get(2)!.observations).every(resource => !resource.drm), 'DRM resources rejected')

tabs = reduceBrowserMedia(tabs, { tabId: 2, type: 'page', pageUrl: 'about:blank' })
assert.equal(tabs.has(2), false, 'browser homepage clears media candidates')
assert.notEqual(observationKey(obs('https://media.example.com/a.mp4')),
  observationKey(obs('https://media.example.com/b.mp4')))

console.info('Browser media lifecycle, dedupe, tabs, playback filtering: OK')
