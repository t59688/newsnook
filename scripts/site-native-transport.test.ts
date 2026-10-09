import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
let redirect = 302
const requests: { url: string; method: string; data?: string }[] = []
const handle = async (options: { url: string; method?: string; data?: string }) => {
  const method = options.method ?? 'GET'
  requests.push({ url: options.url, method, data: options.data })
  if (options.url.endsWith('/search')) return { status: redirect, headers: { location: '/results' }, data: '' }
  return { status: 200, headers: { 'content-type': 'text/html' }, data: Buffer.from('search result').toString('base64') }
}
Object.assign(globalThis, { __catalogBridge: { request: handle, get: (options: Record<string, unknown>) => handle({ ...options, method: 'GET' } as never), post: (options: Record<string, unknown>) => handle({ ...options, method: 'POST' } as never) } })
registerHooks({
  resolve(specifier, context, nextResolve) { if (specifier === '@capacitor/core') return { url: 'file:///catalog-test-capacitor.mjs', shortCircuit: true }; return nextResolve(specifier, context) },
  load(url, context, nextLoad) { if (url === 'file:///catalog-test-capacitor.mjs') return { format: 'module', shortCircuit: true, source: 'export const Capacitor = {isNativePlatform:()=>true,getPlatform:()=>"android"}; export const CapacitorHttp=globalThis.__catalogBridge; export function registerPlugin(){return globalThis.__catalogBridge}' }; return nextLoad(url, context) },
})
const { fetchAbsoluteFormPost, setRuntimeProxyPrefs } = await import('../src/lib/http')
setRuntimeProxyPrefs({ mode: 'always', proxyUrl: 'socks5://127.0.0.1:1080', customBypassDomains: [], customProxyDomains: [] })
let finalUrl: string | undefined
assert.equal(await fetchAbsoluteFormPost('https://example.test/search', [{ name: 'q', value: '中文' }, { name: 'category[]', value: 'news' }, { name: 'category[]', value: 'tools' }], { onResponse: (metadata) => { finalUrl = metadata.url } }), 'search result')
assert.deepEqual(requests.map(({method}) => method), ['POST', 'GET'])
assert.deepEqual(new URLSearchParams(requests[0].data).getAll('category[]'), ['news', 'tools'])
assert.equal(finalUrl, 'https://example.test/results')
requests.length = 0
redirect = 307
await fetchAbsoluteFormPost('https://example.test/search', { q: '中文' })
assert.deepEqual(requests.map(({method}) => method), ['POST', 'POST'])
assert.equal(requests[1].data, requests[0].data)
console.log('site catalog native POST redirect and repeated form fields: ok')
