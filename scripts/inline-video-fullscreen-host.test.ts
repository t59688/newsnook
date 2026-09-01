import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'

import { syncInlineVideoFullscreenHost } from '../src/lib/inlineVideoFullscreenHost'

{
  const { document } = parseHTML(
    '<html><body><article><p id="contained"><video></video></p></article></body></html>',
  )
  const video = document.querySelector('video')
  assert.ok(video)

  const host = document.createElement('div')
  const anchor = document.createComment('reader-inline-video-anchor')
  const player = document.createElement('div')
  player.setAttribute('data-video-fullscreen', 'true')
  host.appendChild(player)
  video.replaceWith(anchor, host)

  syncInlineVideoFullscreenHost(
    host as unknown as HTMLDivElement,
    anchor as unknown as Comment,
    document as unknown as Document,
  )
  assert.equal(
    host.parentNode,
    document.body,
    'native/fallback fullscreen must escape reader layout containment',
  )

  player.removeAttribute('data-video-fullscreen')
  syncInlineVideoFullscreenHost(
    host as unknown as HTMLDivElement,
    anchor as unknown as Comment,
    document as unknown as Document,
  )
  assert.equal(host.parentNode, anchor.parentNode, 'exit must restore the inline portal host')
  assert.equal(host.previousSibling, anchor, 'exit must restore the original article position')
}

console.log('inline-video-fullscreen-host.test.ts: ok')
