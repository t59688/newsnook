import assert from 'node:assert/strict'
import { fetchAbsoluteText } from '../src/lib/http'
import { apexHomepageFallback, fetchProbeEntryPage } from '../src/features/siteCatalog/probeUrl'
const original = globalThis.fetch
let cancelled = false
try {
  globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(20)); }, cancel() { cancelled = true } }), { headers: { 'X-NewsNook-Upstream-Url': 'https://example.test/archive/', 'content-type': 'text/html' } })
  await assert.rejects(fetchAbsoluteText('https://example.test/', { maxBytes: 10 }), /过大/)
  assert.equal(cancelled, true)
  let finalUrl: string | undefined
  globalThis.fetch = async () => new Response('hello', { headers: { 'X-NewsNook-Upstream-Url': 'https://example.test/archive/' } })
  assert.equal(await fetchAbsoluteText('https://example.test/', { onResponse: (metadata) => { finalUrl = metadata.url } }), 'hello')
  assert.equal(finalUrl, 'https://example.test/archive/')
  globalThis.fetch = async () => new Response('hello')
  finalUrl = undefined
  await fetchAbsoluteText('https://example.test/', { onResponse: (metadata) => { finalUrl = metadata.url } })
  assert.equal(finalUrl, undefined, 'proxy response URL must never become upstream URL')
} finally { globalThis.fetch = original }
const wwwUrl = 'https://www.qiyunzl.cn/'
const apexUrl = 'https://qiyunzl.cn/'
assert.equal(apexHomepageFallback(wwwUrl), apexUrl)
for (const path of ['https://www.qiyunzl.cn/list/', 'https://www.qiyunzl.cn/?q=test', 'https://www.qiyunzl.cn:8443/', apexUrl]) {
  assert.equal(apexHomepageFallback(path), undefined, 'fallback must be restricted to a www homepage')
}
let probeCalls: string[] = []
const fallbackResult = await fetchProbeEntryPage(wwwUrl, async (url, onResponse) => {
  probeCalls.push(url)
  if (url === wwwUrl) throw new Error('HTTP 404')
  onResponse({ url: `${apexUrl}category/` })
  return '<article>catalog</article>'
})
assert.deepEqual(probeCalls, [wwwUrl, apexUrl], 'a single 404 may retry the same homepage without www')
assert.deepEqual(fallbackResult, { html: '<article>catalog</article>', url: `${apexUrl}category/` }, 'the resolved URL must be preserved')
probeCalls = []
await assert.rejects(fetchProbeEntryPage(wwwUrl, async (url) => {
  probeCalls.push(url)
  throw new Error('HTTP 403')
}), /HTTP 403/)
assert.deepEqual(probeCalls, [wwwUrl], 'blocked sites must not be retried on another hostname')
probeCalls = []
await assert.rejects(fetchProbeEntryPage(wwwUrl, async (url) => {
  probeCalls.push(url)
  throw new Error('HTTP 404')
}), /HTTP 404/)
assert.deepEqual(probeCalls, [wwwUrl, apexUrl], 'both failed hosts must terminate without loops')
const probeAbort = new AbortController()
probeCalls = []
await assert.rejects(fetchProbeEntryPage(wwwUrl, async (url) => {
  probeCalls.push(url)
  probeAbort.abort()
  throw new Error('HTTP 404')
}, probeAbort.signal), /HTTP 404/)
assert.deepEqual(probeCalls, [wwwUrl], 'aborted probes must not start a fallback request')
console.log('site catalog transport and probe URL fallback: ok')
