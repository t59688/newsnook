import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { parseHTML } from 'linkedom'

const source = readFileSync(new URL('../android/app/src/main/assets/browser-image-probe.js', import.meta.url), 'utf8')
type Owner = Record<string, any>
let fetches = 0
class Reader {
  result = ''
  onload?: () => void
  onerror?: () => void
  async readAsDataURL(blob: Blob) {
    this.result = 'data:' + blob.type + ';base64,' + Buffer.from(await blob.arrayBuffer()).toString('base64')
    this.onload?.()
  }
  abort() {}
}
function owner(html: string, url = 'https://news.example/article?source=1'): Owner {
  const { document } = parseHTML('<html><body>' + html + '</body></html>')
  Object.defineProperty(document, 'baseURI', { value: url })
  return {
    document, location: { href: url }, URL, AbortController, Blob, FileReader: Reader,
    fetch: async (url: string) => { fetches++; return fetch(url.startsWith('blob:') ? 'data:image/png;base64,AQID' : url) },
    getComputedStyle: (node: Element) => ({ backgroundImage: node.getAttribute('data-test-bg') || 'none' }),
  }
}
function scan(window: Owner, scanId = 'scan') {
  const script = source.replace('__NEWSNOOK_IMAGE_KEY__', JSON.stringify('__testImages'))
    .replace('__NEWSNOOK_IMAGE_SCAN__', JSON.stringify(scanId))
  return JSON.parse(runInNewContext(script, { window, location: window.location, Date, URL }))
}
const window = owner(
  '<img id="hero" src="/fallback.jpg" srcset="/small.jpg?w=400 400w, /large.jpg?w=1200 1200w" width="800" height="600">' +
  '<main><picture><source srcset="/p1.webp 1x, /p2.webp 2x"><img src="/picture.jpg" width="800" height="600"></picture>' +
  '<img data-src="/lazy.jpg?signature=one" data-original="/lazy.jpg?signature=two" data-srcset="/lazy-large.jpg 2x" width="900" height="700">' +
  '<img src="data:image/png;base64,AQID" width="120" height="120"><img src="blob:https://news.example/page-image" width="400" height="300">' +
  '<svg><image href="/vector-texture.png" width="300" height="200"/></svg></main>' +
  '<img class="avatar" src="/avatar.png" width="40" height="40">' +
  '<div width="500" height="300" data-test-bg="url(&quot;/background.jpg?a=1&amp;b=2&quot;)"></div>' +
  '<iframe id="accessible"></iframe><iframe id="cross-origin"></iframe>')
Object.defineProperty(window.document.querySelector('#hero'), 'currentSrc', { value: 'https://cdn.example/current.jpg?token=keep&size=large' })
const frame = owner('<img src="/frame.jpg" width="400" height="300">', 'https://news.example/frame')
Object.defineProperty(window.document.querySelector('#accessible'), 'contentWindow', { value: frame })
Object.defineProperty(window.document.querySelector('#cross-origin'), 'contentWindow', { get: () => { throw new Error('SecurityError') } })
const beforeClick = window.document.querySelector('#hero').onclick
const result = scan(window)
const urls = result.items.map((item: Owner) => item.sourceUrl)
for (const expected of [
  'https://cdn.example/current.jpg?token=keep&size=large', 'https://news.example/fallback.jpg',
  'https://news.example/small.jpg?w=400', 'https://news.example/large.jpg?w=1200',
  'https://news.example/p1.webp', 'https://news.example/p2.webp', 'https://news.example/picture.jpg',
  'https://news.example/lazy.jpg?signature=one', 'https://news.example/lazy.jpg?signature=two',
  'https://news.example/lazy-large.jpg', 'https://news.example/vector-texture.png',
  'https://news.example/background.jpg?a=1&b=2', 'https://news.example/frame.jpg',
  'blob:https://news.example/page-image', 'data:',
]) assert.ok(urls.includes(expected), 'missing image source ' + expected)
assert.equal(result.items.find((item: Owner) => item.sourceUrl.endsWith('/avatar.png')).content, false,
  'decorative avatars remain available under all images')
assert.ok(result.items.find((item: Owner) => item.sourceUrl.includes('lazy.jpg')).content)
assert.equal(result.inaccessibleFrames, 1)
assert.equal(fetches, 0, 'scanning only reads metadata; it does not fetch all images')
assert.equal(window.document.querySelector('#hero').onclick, beforeClick, 'the website image click behavior stays intact')
assert.ok(!JSON.stringify(result).includes('AQID'), 'data image bytes stay inside the source page until selected')
const embedded = result.items.find((item: Owner) => item.sourceUrl === 'data:')
const blob = result.items.find((item: Owner) => item.sourceUrl.startsWith('blob:'))
assert.ok(window.__testImages.start(embedded.id, 'load-one', 1024).started)
assert.ok(window.__testImages.start(blob.id, 'load-two', 1024).started)
await new Promise(resolve => setTimeout(resolve, 20))
assert.equal(window.__testImages.read('load-one').dataUrl, 'data:image/png;base64,AQID')
assert.equal(window.__testImages.read('load-two').dataUrl, 'data:image/png;base64,AQID')
assert.equal(fetches, 2, 'page-origin blob/data bytes are copied only on request')
const retired = window.__testImages
scan(window, 'new-scan')
assert.ok(retired.start(embedded.id, 'stale', 1024).error, 'rescan invalidates the retired page export registry')
const duplicates = scan(owner('<img src="/x.jpg?sig=a"><img src="/x.jpg?sig=a"><img src="/x.jpg?sig=b">'))
assert.equal(duplicates.items.length, 2, 'exact URLs dedupe without stripping signed query strings')
const capped = scan(owner(Array.from({ length: 500 }, (_, index) => '<img src="/' + index + '.jpg">').join('')))
assert.equal(capped.items.length, 240)
assert.equal(capped.truncated, true)
assert.ok(!source.includes('addEventListener'), 'manual scanner never hooks site clicks or scroll')
const oversized = owner('<img src="blob:https://news.example/large">')
let aborted = false
oversized.fetch = async (_url: string, options: { signal: AbortSignal }) => {
  options.signal.addEventListener('abort', () => { aborted = true })
  return new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2048)); controller.close() } }),
    { headers: { 'content-type': 'image/png' } })
}
const largeImage = scan(oversized).items[0]
oversized.__testImages.start(largeImage.id, 'bounded', 1024)
await new Promise(resolve => setTimeout(resolve, 20))
assert.ok(oversized.__testImages.read('bounded').error, 'a page blob without content-length is still streamed within a byte budget')
assert.equal(aborted, true, 'an over-budget blob transfer is aborted before it crosses into native')
console.log('Browser image probe: currentSrc, srcset, picture/lazy, CSS, SVG, reachable frames, all/content, page bytes and bounds OK')
