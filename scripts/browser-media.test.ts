import { readableMediaFileName, mediaDisplayText } from '../src/features/mediaSniffer/metadata'
import assert from 'node:assert/strict'
import {
  reduceBrowserMedia,
  browserMediaResources,
  observationKey,
  browserResourceTitle,
  browserResourceDetails,
  browserResourceTracks,
} from '../src/features/browser/browserMedia'
import type { MediaObservation } from '../src/features/mediaSniffer/types'
import { collectPlaybackOrigins, nativePreparePlaybackUrl } from '../src/features/mediaSniffer/native'

let tabs = new Map()
const obs = (url: string, pageUrl = 'https://example.com/watch') => ({
  source: 'network' as const, url, pageUrl, mimeType: 'video/mp4',
  mediaKind: 'video' as const, timestamp: Date.now(),
})

tabs = reduceBrowserMedia(tabs, { tabId: 1, type: 'page', pageUrl: 'https://example.com/watch' })
tabs = reduceBrowserMedia(tabs, { tabId: 1, type: 'observation', observation: obs('https://media.example.com/clip.mp4') })
assert.equal(tabs.get(1)?.observations.length, 1)
assert.equal(browserMediaResources(tabs.get(1)!.observations).length, 1)
assert.equal(browserResourceTitle(browserMediaResources(tabs.get(1)!.observations)[0]), 'clip')
tabs = reduceBrowserMedia(tabs, { tabId: 1, type: 'observation', observation: obs('https://media.example.com/clip.mp4') })
assert.equal(tabs.get(1)?.observations.length, 1, 'duplicate media should be de-duplicated')

const fromEntriesDescriptor = Object.getOwnPropertyDescriptor(Object, 'fromEntries')!
try {
  Object.defineProperty(Object, 'fromEntries', { configurable: true, writable: true, value: undefined })
  tabs = reduceBrowserMedia(tabs, { tabId: 1, type: 'observation', observation: {
    ...obs('https://media.example.com/clip.mp4'), height: 1080, width: 1920, hasAudio: true, hasVideo: true,
  } })
} finally {
  Object.defineProperty(Object, 'fromEntries', fromEntriesDescriptor)
}
assert.equal(tabs.get(1)?.observations.length, 1, 'richer observations update the existing resource instead of duplicating it')
assert.equal(browserResourceTitle(browserMediaResources(tabs.get(1)!.observations)[0]), 'clip', 'late player metadata must reach the resource picker')
tabs = reduceBrowserMedia(tabs, { tabId: 1, type: 'observation', observation: obs('https://media.example.com/clip.mp4') })
assert.equal(browserResourceTitle(browserMediaResources(tabs.get(1)!.observations)[0]), 'clip', 'a later network-only observation cannot erase player metadata')

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

const samePage = 'https://example.com/watch'
const retainedVideo = { ...obs('https://media.example.com/retained.mp4'), height: 1080 }
const rescannedVideo = obs('https://media.example.com/discovered-on-scan.mp4')
let resumedTabs = reduceBrowserMedia(new Map(), { tabId: 7, type: 'page', pageUrl: samePage })
resumedTabs = reduceBrowserMedia(resumedTabs, { tabId: 7, type: 'observation', observation: retainedVideo })
resumedTabs = reduceBrowserMedia(resumedTabs, { tabId: 8, type: 'observation', observation: obs('https://media.example.com/other-tab.mp4') })
const retainedKeys = [...resumedTabs.get(7)!.keys]
resumedTabs = reduceBrowserMedia(resumedTabs, { tabId: 7, type: 'page', pageUrl: samePage })
assert.deepEqual(resumedTabs.get(7)!.observations, [retainedVideo], 'announcing the same page after becoming visible preserves discovered media')
assert.deepEqual([...resumedTabs.get(7)!.keys], retainedKeys, 'a visibility announcement preserves de-duplication keys')

// Explicit scan can announce the page and repeat known observations before finding another resource.
resumedTabs = reduceBrowserMedia(resumedTabs, { tabId: 7, type: 'page', pageUrl: samePage })
resumedTabs = reduceBrowserMedia(resumedTabs, { tabId: 7, type: 'observation', observation: retainedVideo })
resumedTabs = reduceBrowserMedia(resumedTabs, { tabId: 7, type: 'observation', observation: rescannedVideo })
assert.equal(resumedTabs.get(7)!.observations.length, 2, 'same-page scan retains known media while admitting new resources')
assert.ok(resumedTabs.get(7)!.keys.has(observationKey(retainedVideo)), 'same-page scan does not discard the known resource key')

const beforeReload = resumedTabs.get(7)!
const otherTab = resumedTabs.get(8)!
resumedTabs = reduceBrowserMedia(resumedTabs, { tabId: 7, type: 'reset', pageUrl: samePage })
assert.equal(resumedTabs.get(7)!.pageUrl, samePage, 'same-URL reload keeps the page address')
assert.deepEqual(resumedTabs.get(7)!.observations, [], 'same-URL reload drops media from the previous document')
assert.equal(resumedTabs.get(7)!.keys.size, 0, 'same-URL reload clears de-duplication keys for the next document')
assert.deepEqual(browserMediaResources(resumedTabs.get(7)!.observations), [], 'the resource picker cannot expose stale media after reload')
assert.equal(resumedTabs.get(8), otherTab, 'reloading one tab preserves another tab media')
assert.equal(beforeReload.observations.length, 2, 'reset does not mutate the retired document snapshot')
resumedTabs = reduceBrowserMedia(resumedTabs, { tabId: 7, type: 'observation', observation: { ...retainedVideo, height: 720 } })
assert.equal(resumedTabs.get(7)!.observations.length, 1, 'a resource with the same key is admitted in the new document')
assert.equal(resumedTabs.get(7)!.observations[0].height, 720, 'the new document does not inherit old playback metadata')
assert.equal(resumedTabs.get(7)!.keys.size, 1)

const sourcePage = 'https://watch.example/video'
const requestHeaders = { Referer: sourcePage, Origin: 'https://watch.example', 'User-Agent': 'NewsNook fixture' }
const pair: MediaObservation[] = [
  { source: 'xhr', pageUrl: sourcePage, assetGroup: 'separate-av', requestHeaders,
    url: 'https://video.example/video.m4s?token=video&expire=123', mimeType: 'video/mp4', mediaKind: 'video',
    height: 1080, width: 1920, codecs: 'avc1.640028', initializationRange: '0-999', indexRange: '1000-1499' },
  { source: 'xhr', pageUrl: sourcePage, assetGroup: 'separate-av', requestHeaders,
    url: 'https://audio.example/audio.m4s?token=audio&expire=123', mimeType: 'audio/mp4', mediaKind: 'audio',
    codecs: 'mp4a.40.2', initializationRange: '0-499', indexRange: '500-999' },
]
const originalCreateObjectURL = URL.createObjectURL
const createdObjectUrls: string[] = []
URL.createObjectURL = blob => {
  const url = originalCreateObjectURL(blob)
  createdObjectUrls.push(url)
  return url
}
try {
  const [dash] = browserMediaResources(pair)
  assert.ok(dash, 'a locally synthesized DASH pair must remain available in the browser resource picker')
  assert.equal(dash.type, 'dash')
  assert.match(dash.url, /^data:application\/dash\+xml,/)
  const manifest = decodeURIComponent(dash.url.slice(dash.url.indexOf(',') + 1))
  assert.match(manifest, /video\.m4s\?token=video&amp;expire=123/)
  assert.match(manifest, /audio\.m4s\?token=audio&amp;expire=123/)
  assert.equal(dash.hasAudio, true)
  assert.equal(dash.pageUrl, sourcePage)
  assert.deepEqual(dash.requestHeaders, requestHeaders, 'the player handoff retains the request context')
  assert.deepEqual(dash.relatedUrls, pair.map(item => item.url), 'both signed track URLs reach the native playback bridge unchanged')
  assert.equal(nativePreparePlaybackUrl({ url: dash.url, sourcePage }), sourcePage, 'native setup uses the source page for a generated manifest')
  assert.deepEqual(collectPlaybackOrigins({ url: dash.url, sourcePage, extraUrls: dash.relatedUrls }).sort(),
    ['https://audio.example', 'https://video.example', 'https://watch.example'])
  for (let iteration = 0; iteration < 3; iteration++) {
    assert.equal(browserMediaResources(pair)[0].url, dash.url, 'repeated discovery keeps a stable generated manifest URL')
  }
  assert.equal(createdObjectUrls.length, 0, 'resource discovery must not accumulate object URLs that have no owner to revoke them')
  assert.deepEqual(browserMediaResources([{ ...pair[0], url: 'blob:https://watch.example/page-created' }]), [], 'page-owned blob observations are not admitted by the synthetic DASH exception')
  assert.deepEqual(browserMediaResources([{ ...pair[0], url: dash.url, mimeType: 'application/dash+xml' }]), [], 'a page-supplied data manifest is not a locally built descriptor')
  assert.deepEqual(browserMediaResources(pair.map(item => ({ ...item, drmKeySystem: 'com.widevine.alpha' }))), [], 'synthetic DASH does not bypass DRM filtering')
} finally {
  URL.createObjectURL = originalCreateObjectURL
  createdObjectUrls.forEach(url => URL.revokeObjectURL(url))
}

console.info('Browser media lifecycle, same-URL reset versus visibility/scan, dedupe, tabs, playback filtering and DASH handoff: OK')

{
  const resources = browserMediaResources([
    { ...obs('https://cdn.example/%E5%B1%B1%E6%B5%B7%E7%BA%AA%E8%A1%8C.mp4?token=do-not-show'), fromIframe: true, height: 1080, bitrate: 3200000 },
    obs('https://cdn.example/1234567890.mp4?signature=private'),
    obs('https://cdn.example/550e8400-e29b-41d4-a716-446655440000.m3u8'),
    { ...obs('https://cdn.example/another.mp4'), isAd: true },
  ])
  assert.equal(resources.length, 3)
  assert.equal(browserResourceTitle(resources.find(r => r.url.includes('%E5'))!), '山海纪行')
  const fallback = resources.filter(r => r.titleSource === 'generated')
  assert.deepEqual(fallback.map(browserResourceTitle).sort(), ['视频资源 02', '视频资源 03'])
  assert.deepEqual(browserMediaResources([
    { ...obs('https://cdn.example/%E5%B1%B1%E6%B5%B7%E7%BA%AA%E8%A1%8C.mp4?token=changed'), height: 1080 },
    obs('https://cdn.example/1234567890.mp4?signature=changed'),
    obs('https://cdn.example/550e8400-e29b-41d4-a716-446655440000.m3u8'),
  ]).filter(r => r.titleSource === 'generated').map(browserResourceTitle).sort(), fallback.map(browserResourceTitle).sort(), 'fallback numbers survive score sorting and signature renewal')
  assert.ok(resources.every(r => !browserResourceTitle(r).includes('?')))
}

{
  const [resource] = browserMediaResources([{ ...obs('https://cdn.example/v.mp4?token=hidden'), title: '播放器名称', titleSource: 'player', fromIframe: true,
    height: 1080, bitrate: 3200000, codecs: 'avc1.640028', hasAudio: true }])
  assert.equal(browserResourceTitle(resource), '播放器名称')
  assert.ok(browserResourceDetails(resource).join(' ').includes('iframe'))
  assert.ok(browserResourceTracks(resource).join(' ').includes('1080p · 3.2 Mbps'))
  assert.doesNotMatch([...browserResourceDetails(resource), ...browserResourceTracks(resource), browserResourceTitle(resource)].join(' '), /token|hidden|https:|\?/)
}

{
  const [resource] = browserMediaResources([{
    ...obs('https://hn.bfvs.com/play/bkRwn5Ja/index.m3u8?sign=private', 'https://qiyunzl.cn/data/wmhyd.html'),
    mimeType: 'application/vnd.apple.mpegurl', fromIframe: true, playerSource: 'qiyunzl.cn',
    pageTitle: '我们好一点',
  }])
  assert.equal(browserResourceTitle(resource), '我们好一点', 'article/page title is a clearly lower-priority fallback when the stream has no own title or readable filename')
  const visible = browserResourceDetails(resource).join(' ') + ' ' + browserResourceTracks(resource).join(' ')
  assert.match(visible, /HLS/)
  assert.match(visible, /qiyunzl\.cn/)
  assert.match(visible, /hn\.bfvs\.com/)
  assert.match(visible, /页面标题/)
  assert.doesNotMatch(visible + browserResourceTitle(resource), /sign=private|https:|\?/)
}

for (const url of ['https://cdn.example/550e8400-e29b-41d4-a716-446655440000.mp4?title=secret',
  'https://cdn.example/abcdef0123456789abcdef0123456789.mp4', 'https://cdn.example/123456.mp4',
  'https://cdn.example/%E0%A4%A.mp4', 'https://cdn.example/hello%3Ftoken%3Dprivate.mp4']) {
  assert.equal(readableMediaFileName(url), undefined)
}
assert.equal(readableMediaFileName('https://cdn.example/海边-日落_550e8400-e29b-41d4-a716-446655440000.mp4?signature=private'), '海边 日落')
assert.equal(mediaDisplayText('https://cdn.example/a?token=secret'), undefined)
{
  const observations: MediaObservation[] = [
    { ...obs('https://cdn.example/main.mp4'), title: '正片', titleSource: 'player' },
    { ...obs('https://cdn.example/spot.mp4'), isAd: true },
    { ...obs('https://cdn.example/drm.mp4'), drmKeySystem: 'com.widevine.alpha' },
  ]
  assert.deepEqual(browserMediaResources(observations).map(r => r.title), ['正片'])
  const blocked = browserMediaResources(observations, { includeBlocked: true }).filter(r => r.isAd || r.drm)
  assert.equal(blocked.length, 2, 'diagnostics preserve blocked resource metadata without entering playback choices')
  assert.match(blocked.map(r => browserResourceDetails(r).join(' ')).join(' '), /DRM/)
}
