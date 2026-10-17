import assert from 'node:assert/strict'
import {
  BrowserImageLoader, BrowserImageMemory, browserImageBlob, dedupeBrowserImages,
  isBrowserImageResponseCurrent, isBrowserImageSnapshot,
  type BrowserImageCandidate, type BrowserImageData, type BrowserImageLoadRequest, type BrowserImageSnapshot,
} from '../src/features/browser/browserImages'

const candidate = (id: string, sourceUrl = 'https://cdn.example/image.jpg?token=' + id): BrowserImageCandidate => ({
  id, sourceUrl, pageUrl: 'https://example/article', alt: '', width: 800, height: 600,
  content: true, kinds: ['img'], transport: 'http',
})
const snapshot: BrowserImageSnapshot = {
  tabId: 3, documentId: 'document-one', requestId: 'scan-one', pageUrl: 'https://example/article',
  items: [candidate('one'), candidate('two'), candidate('three')], truncated: false, inaccessibleFrames: 0,
}
assert.ok(isBrowserImageSnapshot(snapshot))
assert.ok(!isBrowserImageSnapshot({ ...snapshot, documentId: '' }))
assert.ok(!isBrowserImageSnapshot({ ...snapshot, items: Array(241).fill(candidate('one')) }))
assert.equal(dedupeBrowserImages([candidate('a'), candidate('b'), candidate('another', candidate('a').sourceUrl)]).length, 2,
  'signed queries and responsive query variants must stay distinct')
assert.equal(dedupeBrowserImages([candidate('a', 'data:'), candidate('b', 'data:')]).length, 2,
  'data URLs are elided, so independent native ids must not collapse')
const response = (request: BrowserImageLoadRequest, overrides: Partial<BrowserImageData> = {}): BrowserImageData => ({
  ...request, dataUrl: 'data:image/png;base64,AQID', mimeType: 'image/png', byteLength: 3,
  width: 1, height: 1, reduced: false, ...overrides,
})
const request: BrowserImageLoadRequest = { tabId: 3, documentId: 'document-one', requestId: 'image-one', imageId: 'one', thumbnail: true }
assert.ok(isBrowserImageResponseCurrent(request, response(request)))
for (const overrides of [{ tabId: 4 }, { documentId: 'same-url-reloaded' }, { requestId: 'late' }, { imageId: 'other' }]) {
  assert.ok(!isBrowserImageResponseCurrent(request, response(request, overrides)))
}
assert.equal(browserImageBlob(response(request)).size, 3)
assert.throws(() => browserImageBlob(response(request, { mimeType: 'text/html' })), /格式/)
assert.throws(() => browserImageBlob(response(request, { byteLength: 4 })), /不完整/)
assert.throws(() => browserImageBlob(response(request, { byteLength: 7 * 1024 * 1024 })), /预算/)
const created: string[] = [], revoked: string[] = []
const create = URL.createObjectURL, revoke = URL.revokeObjectURL
URL.createObjectURL = () => { const value = 'blob:test-' + created.length; created.push(value); return value }
URL.revokeObjectURL = value => { revoked.push(value) }
try {
  const memory = new BrowserImageMemory()
  for (let index = 0; index < 4; index++) memory.put('full-' + index, new Blob(['test']), false)
  assert.equal(memory.get('full-0'), undefined, 'only three full-size images remain')
  assert.ok(revoked.includes('blob:test-0'))
  for (let index = 0; index < 49; index++) memory.put('thumb-' + index, new Blob(['t']), true)
  assert.equal(memory.get('thumb-0'), undefined, 'thumbnail URLs have an independent 48-entry bound')
  memory.close()
  assert.equal(revoked.length, created.length, 'closing releases every created object URL')
  assert.throws(() => memory.put('late', new Blob(['late']), false), /关闭/)

  const pending: { request: BrowserImageLoadRequest; resolve: (data: BrowserImageData) => void }[] = []
  const cancelled: unknown[] = []
  let changed = 0
  const loader = new BrowserImageLoader(snapshot, req => new Promise(resolve => pending.push({ request: req, resolve })),
    async req => { cancelled.push(req) }, () => changed++)
  const loads = snapshot.items.map(item => loader.load(item, true))
  await Promise.resolve()
  assert.equal(pending.length, 2, 'at most two native loads start concurrently')
  assert.equal(loader.load(snapshot.items[0], true), loads[0], 'duplicate requests share the pending promise')
  pending[0].resolve(response(pending[0].request))
  await loads[0]
  await Promise.resolve()
  assert.equal(pending.length, 3, 'the next thumbnail starts only after one request finishes')
  pending[1].resolve(response(pending[1].request))
  pending[2].resolve(response(pending[2].request))
  await Promise.all(loads)
  assert.equal(changed, 3)
  assert.ok(loader.cached(snapshot.items[0], true))
  loader.close()
  assert.deepEqual(cancelled.at(-1), { tabId: 3, documentId: 'document-one', requestId: 'scan-one' },
    'a closing snapshot cannot cancel a newer scan in the same document')

  const late: { request?: BrowserImageLoadRequest; resolve?: (data: BrowserImageData) => void } = {}
  let lateChanges = 0
  const closing = new BrowserImageLoader(snapshot, req => new Promise(resolve => { late.request = req; late.resolve = resolve }),
    async () => {}, () => lateChanges++)
  const inFlight = closing.load(snapshot.items[0], false).catch(error => error.message)
  await Promise.resolve()
  closing.close()
  late.resolve!(response(late.request!))
  assert.equal(await inFlight, '图片读取已取消')
  await Promise.resolve()
  assert.equal(lateChanges, 0, 'a completion after close does not update UI or allocate a URL')

  let dispatches = 0
  const immediate = new BrowserImageLoader(snapshot, async req => { dispatches++; return response(req) }, async () => {}, () => {})
  const cancelledBeforeDispatch = immediate.load(snapshot.items[0], false).catch(() => {})
  immediate.close()
  await cancelledBeforeDispatch
  await Promise.resolve()
  assert.equal(dispatches, 0, 'closing before the native microtask prevents its dispatch')

  const stale = new BrowserImageLoader(snapshot, async req => response(req, { documentId: 'same-url-new-document' }),
    async () => {}, () => {})
  await assert.rejects(stale.load(snapshot.items[0], false), /网页已变化/)
  assert.equal(stale.cached(snapshot.items[0], false), undefined)
  stale.close()

  let attempts = 0
  const retry = new BrowserImageLoader(snapshot, async req => {
    attempts++
    if (attempts === 1) throw new Error('HTTP 403')
    return response(req)
  }, async () => {}, () => {})
  await assert.rejects(retry.load(snapshot.items[0], false), /403/)
  await assert.rejects(retry.load(snapshot.items[0], false), /403/)
  assert.equal(attempts, 1, 'failed images do not spin in an automatic retry loop')
  await retry.load(snapshot.items[0], false, true)
  assert.equal(attempts, 2)
  retry.close()

  const windowPending: { request: BrowserImageLoadRequest; resolve: (data: BrowserImageData) => void }[] = []
  const windowCancelled: BrowserImageLoadRequest[] = []
  const switching = new BrowserImageLoader(snapshot, req => new Promise(resolve => windowPending.push({ request: req, resolve })),
    async req => { if ('imageId' in req) windowCancelled.push(req as BrowserImageLoadRequest) }, () => {})
  const abandoned = snapshot.items.map(item => switching.load(item, false).catch(error => error.message))
  await Promise.resolve()
  const destination = candidate('destination')
  switching.displayWindow([destination])
  const selected = switching.load(destination, false)
  await Promise.resolve()
  assert.equal(windowCancelled.length, 2, 'rapid selection cancels the two running images outside the display window')
  assert.equal(windowPending.length, 3, 'the abandoned queued neighbour never reaches native')
  windowPending[0].resolve(response(windowPending[0].request))
  windowPending[1].resolve(response(windowPending[1].request))
  windowPending[2].resolve(response(windowPending[2].request))
  await Promise.all(abandoned)
  await selected
  assert.ok(switching.cached(destination, false))
  assert.equal(switching.cached(snapshot.items[0], false), undefined, 'late images cannot evict or replace the current image')
  const exportPromise = switching.original(destination).catch(error => error.message)
  await Promise.resolve()
  switching.cancelExports()
  assert.equal(await exportPromise, '图片读取已取消', 'closing a viewer cancels an original-byte request before any export')
  switching.close()
} finally {
  URL.createObjectURL = create
  URL.revokeObjectURL = revoke
}
console.log('Browser images: native identity, signed URLs, memory bounds, concurrent queue, retries and cancellation OK')
