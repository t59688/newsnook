import assert from 'node:assert/strict'
import { fetchAbsoluteText } from '../src/lib/http'
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
console.log('site catalog transport: ok')
