import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { Capacitor } from '@capacitor/core'
import type { HlsConfig, LoaderContext, LoaderConfiguration } from 'hls.js'
import { createHotlinkHlsLoader, fetchMediaBytes } from '../src/lib/mediaFetch'
import { onRequest } from '../functions/api/[[path]].ts'
import { createServer as createViteServer } from 'vite'

Object.assign(Capacitor, { isNativePlatform: () => false })
const bytes = Buffer.from('0123456789')
const requests: string[] = []
const server = createServer((req, res) => {
  requests.push(req.headers.range ?? '')
  if (req.url?.includes('eof')) {
    res.writeHead(206, { 'Content-Range': 'bytes 0-9/10' }); res.end(bytes)
  } else if (req.url?.includes('invalid')) {
    res.writeHead(206, { 'Content-Range': 'bytes 3-6/10' }); res.end(bytes.subarray(3, 7))
  } else if (req.url?.includes('partial')) {
    res.writeHead(206, { 'Content-Range': 'bytes 2-5/10' })
    res.end(bytes.subarray(2, 6))
  } else if (req.url?.includes('slow')) { setTimeout(() => res.end(bytes), 80) }
  else { res.end(bytes) }
})
server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
assert.ok(address && typeof address !== 'string')
const base = `http://127.0.0.1:${address.port}`
const originalFetch = globalThis.fetch
globalThis.fetch = ((input, init) => originalFetch(
  String(input).startsWith('/api/media?') ? `${base}/${new URL(String(input), base).searchParams.get('url')}` : input,
  init,
)) as typeof fetch
async function load(url: string) {
  const Loader = createHotlinkHlsLoader()!
  const loader = new Loader({} as HlsConfig)
  try {
    return await new Promise<ArrayBuffer>((resolve, reject) => loader.load({
      url, responseType: 'arraybuffer', rangeStart: 2, rangeEnd: 6,
    } as LoaderContext, { timeout: 1000 } as LoaderConfiguration, {
      onSuccess: response => resolve(response.data as ArrayBuffer),
      onError: error => reject(new Error(error.text)), onTimeout: () => reject(new Error('timeout')),
    }))
  } finally { loader.destroy() }
}
try {
  assert.equal(Buffer.from(await load('partial')).toString(), '2345')
  assert.equal(requests.at(-1), 'bytes=2-5', 'HLS rangeEnd is exclusive')
  assert.equal(Buffer.from(await load('full')).toString(), '2345', 'slice a full 200 response when upstream ignores Range')
  assert.equal(Buffer.from((await fetchMediaBytes('full', undefined, { range: 'bytes=0-524287' })).data).toString(), '0123456789', 'manifest discovery range may extend beyond EOF')
  assert.equal(Buffer.from((await fetchMediaBytes('eof', undefined, { range: 'bytes=0-524287' })).data).toString(), '0123456789', 'legal partial responses may end at EOF')
  await assert.rejects(load('invalid'), /Unexpected media byte range/, 'wrong segment offsets must fail rather than feed the decoder')
  const Loader = createHotlinkHlsLoader()!
  const reused = new Loader({} as HlsConfig)
  let cancelledCallbacks = 0
  try {
    reused.load({ url: 'slow-old', responseType: 'arraybuffer' } as LoaderContext, { timeout: 25 } as LoaderConfiguration, {
      onSuccess: () => cancelledCallbacks++, onError: () => cancelledCallbacks++, onTimeout: () => cancelledCallbacks++,
    })
    await new Promise(resolve => setTimeout(resolve, 5))
    await new Promise<void>((resolve, reject) => reused.load({ url: 'slow-new', responseType: 'arraybuffer' } as LoaderContext, { timeout: 500 } as LoaderConfiguration, {
      onSuccess: () => resolve(), onError: error => reject(new Error(error.text)), onTimeout: () => reject(new Error('replacement timed out')),
    }))
    assert.equal(cancelledCallbacks, 0, 'replacing a load cancels its timeout and callbacks')
  } finally { reused.destroy() }
  let range = ''
  globalThis.fetch = (async (_input, init) => {
    range = new Headers(init?.headers).get('Range') ?? ''
    return new Response(bytes.subarray(2, 6), { status: 206, headers: {
      'Content-Range': 'bytes 2-5/10', 'Accept-Ranges': 'bytes',
    } })
  }) as typeof fetch
  const response = await onRequest({ request: new Request('https://news.aizeek.com/api/media?url=https://example.com/video', {
    headers: { Range: 'bytes=2-5' },
  }), params: { path: ['media'] }, functionPath: '/api/media', waitUntil: () => {}, next: async () => new Response(), env: {}, data: {} })
  assert.equal(range, 'bytes=2-5', 'edge proxy forwards range')
  assert.equal(response.status, 206)
  assert.equal(response.headers.get('Content-Range'), 'bytes 2-5/10')
  assert.equal(response.headers.get('Accept-Ranges'), 'bytes')
  assert.equal(response.headers.get('Cache-Control'), 'no-store', 'partial responses must not poison full-resource caches')
  assert.match(response.headers.get('Access-Control-Expose-Headers') ?? '', /Content-Range/i)
  globalThis.fetch = originalFetch
  const vite = await createViteServer({ server: { port: 0, host: '127.0.0.1' }, logLevel: 'silent' })
  try {
    await vite.listen()
    const viteAddress = vite.httpServer?.address()
    assert.ok(viteAddress && typeof viteAddress !== 'string')
    const devResponse = await originalFetch(`http://127.0.0.1:${viteAddress.port}/api/media?url=${encodeURIComponent(`${base}/partial`)}`, {
      headers: { Range: 'bytes=2-5' },
    })
    assert.equal(requests.at(-1), 'bytes=2-5', 'development proxy forwards range to the real upstream')
    assert.equal(devResponse.status, 206)
    assert.equal(devResponse.headers.get('Content-Range'), 'bytes 2-5/10')
    assert.equal(devResponse.headers.get('Cache-Control'), 'no-store')
    assert.equal(await devResponse.text(), '2345')
  } finally { await vite.close() }
  console.log('media range: HLS 206, HLS 200 fallback, edge and development forwarding passed')
} finally { globalThis.fetch = originalFetch; server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
