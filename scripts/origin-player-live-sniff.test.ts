import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { reduceLiveObservations } from '../src/features/mediaSniffer/liveCandidate'
import {
  isFloatButtonEligible,
  shouldUseOriginPlayerSurface,
} from '../src/features/mediaSniffer/originPlayerGate'
import type { MediaDescriptor } from '../src/features/mediaSniffer/types'

assert.equal(
  shouldUseOriginPlayerSurface({ sourceId: 'custom_abc', contentType: 'video', platform: 'android' }),
  true,
)
assert.equal(
  shouldUseOriginPlayerSurface({ sourceId: 'netease', contentType: 'video', platform: 'android' }),
  false,
)
assert.equal(
  shouldUseOriginPlayerSurface({ sourceId: 'custom_abc', contentType: 'video', platform: 'web' }),
  false,
)
assert.equal(
  shouldUseOriginPlayerSurface({ sourceId: 'custom_abc', contentType: 'article', platform: 'android' }),
  false,
)

function baseDescriptor(
  overrides: Partial<MediaDescriptor> & Pick<MediaDescriptor, 'type' | 'url'>,
): MediaDescriptor {
  return {
    pageUrl: 'https://play.example/1',
    score: 80,
    videoTracks: [],
    audioTracks: [],
    subtitles: [],
    drm: false,
    drmKeySystems: [],
    ...overrides,
  }
}

const ad = baseDescriptor({
  type: 'progressive',
  url: 'https://cdn.example/ad/preroll.mp4',
  isAd: true,
})
const hls = baseDescriptor({
  type: 'hls',
  url: 'https://cdn.example/index.m3u8',
  isAd: false,
})
const unmarkedAdUrl = baseDescriptor({
  type: 'progressive',
  url: 'https://cdn.example/preroll/spot.mp4',
})
const drmHls = baseDescriptor({
  type: 'hls',
  url: 'https://cdn.example/protected.m3u8',
  drm: true,
})

assert.equal(isFloatButtonEligible(null), false)
assert.equal(isFloatButtonEligible(ad), false)
assert.equal(isFloatButtonEligible(hls), true)
assert.equal(isFloatButtonEligible(unmarkedAdUrl), false)
assert.equal(isFloatButtonEligible(drmHls), false)

const withAdPrimaryResource = baseDescriptor({
  type: 'hls',
  url: 'https://cdn.example/index.m3u8',
  resources: [ad, hls],
})
assert.equal(
  isFloatButtonEligible(withAdPrimaryResource),
  false,
  'resources[0] 为广告时不得亮浮钮',
)

assert.equal(
  reduceLiveObservations([
    {
      url: 'https://cdn.example/ad/preroll.mp4',
      pageUrl: 'https://play.example/1',
      source: 'network',
      mimeType: 'video/mp4',
    },
  ]),
  null,
)
const withHls = reduceLiveObservations([
  {
    url: 'https://cdn.example/ad/preroll.mp4',
    pageUrl: 'https://play.example/1',
    source: 'network',
    mimeType: 'video/mp4',
  },
  {
    url: 'https://cdn.example/index.m3u8',
    pageUrl: 'https://play.example/1',
    source: 'network',
  },
])
assert.equal(withHls?.type, 'hls')
assert.equal(withHls?.url, 'https://cdn.example/index.m3u8')

{
  const surface = readFileSync(
    join(process.cwd(), 'src/components/OriginPlayerSurface.tsx'),
    'utf8',
  )
  assert.match(
    surface,
    /sessionReadyRef\.current = true/,
    'must mark live session ready before pushing bounds',
  )
  assert.match(
    surface,
    /findScrollParents/,
    'must sync bounds on Reader overflow scroll parents, not only window',
  )
  assert.match(
    surface,
    /startNativeLiveSniffSession\([\s\S]*?\.then\([\s\S]*?syncAfterNativeReady/,
    'must push slot bounds after native WebView is created (pre-start calls are no-ops)',
  )
  assert.match(
    surface,
    /visualViewport/,
    'must follow visualViewport shifts that move the media slot',
  )
}

{
  const plugin = readFileSync(
    join(
      process.cwd(),
      'android/app/src/main/java/com/aizeek/newsnook/MediaSnifferPlugin.java',
    ),
    'utf8',
  )
  const visibleStart = plugin.indexOf('public void setLiveSessionVisible')
  const boundsStart = plugin.indexOf('public void setLiveSessionBounds', visibleStart)
  assert.ok(visibleStart >= 0 && boundsStart > visibleStart)
  const visibleBlock = plugin.slice(visibleStart, boundsStart)
  assert.match(
    visibleBlock,
    /MUTE_AUDIO/,
    'hiding live WebView must prefer WebView-level mute to keep the origin document',
  )
  assert.match(
    visibleBlock,
    /setAudioMuted/,
    'must call WebViewCompat.setAudioMuted when mute is supported',
  )
  assert.match(
    visibleBlock,
    /onPause\(\)/,
    'hiding live WebView must pause the WebView',
  )
  assert.match(
    visibleBlock,
    /about:blank/,
    'must blank only as fallback when MUTE_AUDIO is unavailable',
  )
  assert.match(
    visibleBlock,
    /reloadLiveEntry/,
    'showing after blank-fallback must reload the origin entry URL',
  )
}

{
  const overlaySource = readFileSync(
    join(process.cwd(), 'src/components/inkVideoPlayer/MediaResourceOverlay.tsx'),
    'utf8',
  )
  const overlayStart = overlaySource.indexOf('function MediaResourceOverlay')
  assert.ok(overlayStart >= 0, 'MediaResourceOverlay must exist')
  const overlay = overlaySource.slice(overlayStart, overlayStart + 4500)
  assert.match(
    overlay,
    /items-end/,
    'sniff resource sheet must rise from the bottom like OptionPickerDialog',
  )
  assert.match(
    overlay,
    /\{!open && \(/,
    'capsule must hide while the bottom sheet is open',
  )
  assert.match(
    overlay,
    /bg-black\/60/,
    'sheet must use the shared modal scrim',
  )
}

console.log('origin-player-live-sniff tests passed')
