import assert from 'node:assert/strict'
import { DOMParser } from 'linkedom'
import { previewFeed } from '../src/features/feedDiscovery/preview'
import { saveSubscriptionState } from '../src/lib/storage'

Object.assign(globalThis, { DOMParser })
const originalFetch = globalThis.fetch
try {
  globalThis.fetch = async () => new Response('{"version":"arbitrary","items":[]}')
  assert.equal((await previewFeed('https://example.com/feed')).ok, false, 'arbitrary JSON version is not a JSON Feed')
  globalThis.fetch = async () => new Response('{"version":"https://jsonfeed.org/version/1.1","title":"Empty","items":[]}')
  assert.equal((await previewFeed('https://example.com/feed')).ok, true)
  for (const xml of ['<rss version="2.0"><channel><title>Empty RSS</title></channel></rss>', '<feed xmlns="http://www.w3.org/2005/Atom"><title>Empty Atom</title></feed>']) {
    globalThis.fetch = async () => new Response(xml)
    const empty = await previewFeed('https://example.com/feed')
    assert.equal(empty.ok, true)
    if (empty.ok) assert.equal(empty.itemCount, 0)
  }
  globalThis.fetch = async () => new Response('<html><head><title>Just a moment...</title></head><body>Verify you are human</body></html>')
  const challenge = await previewFeed('https://example.com/feed')
  assert.equal(challenge.ok, false)
  if (!challenge.ok) assert.equal(challenge.retryable, false)
  for (const xml of ['<rss/>', '<feed/>', '<rss><channel></rss>']) {
    globalThis.fetch = async () => new Response(xml)
    assert.equal((await previewFeed('https://example.com/feed')).ok, false, 'invalid XML is not an empty valid feed')
  }
  for (const status of [403, 404, 429]) {
    globalThis.fetch = async () => new Response('', { status })
    const result = await previewFeed('https://example.com/feed')
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.kind, { 403: 'forbidden', 404: 'not-found', 429: 'rate-limited' }[status])
  }
  let requested = false
  globalThis.fetch = async (_url, options) => {
    requested = true
    return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))
  }
  const cancelled = new AbortController()
  cancelled.abort()
  const result = await previewFeed('https://example.com/feed', { signal: cancelled.signal, timeoutMs: 1000 })
  assert.equal(requested, false, 'already cancelled preview must not request the network')
  if (!result.ok) assert.equal(result.kind, 'aborted')
  const timeout = await previewFeed('https://example.com/feed', { timeoutMs: 1000 })
  assert.equal(timeout.ok, false)
  if (!timeout.ok) assert.equal(timeout.kind, 'timeout', 'fetch AbortError caused by deadline is a timeout')
} finally {
  globalThis.fetch = originalFetch
}
const stored = new Map([['newsnook:preferences', 'old prefs'], ['newsnook:enabled', 'old enabled']])
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { if (key.endsWith(':enabled') && value !== 'old enabled') throw new Error('quota'); stored.set(key, value) },
  removeItem: (key: string) => stored.delete(key),
} })
assert.throws(() => saveSubscriptionState({ new: true }, ['new']), /quota/)
assert.equal(stored.get('newsnook:preferences'), 'old prefs', 'failed aggregate write rolls back preference write')
stored.set('newsnook:presets', 'old presets')
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => stored.get(key) ?? null,
  setItem: (key: string, value: string) => { if (key.endsWith(':presets') && value !== 'old presets') throw new Error('quota'); stored.set(key, value) },
  removeItem: (key: string) => stored.delete(key),
} })
assert.throws(() => saveSubscriptionState({ new: true }, ['new'], { new: true }), /quota/)
assert.equal(stored.get('newsnook:preferences'), 'old prefs', 'failed preset cleanup rolls back preferences')
assert.equal(stored.get('newsnook:enabled'), 'old enabled', 'failed preset cleanup rolls back aggregate members')
globalThis.fetch = originalFetch
console.log('feed discovery runtime: ok')
