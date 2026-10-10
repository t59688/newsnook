import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
let redirect = 302
let redirectLocation = '/results'
const requests: { url: string; method: string; data?: string; bridge?: string; headers?: Record<string, string>; webViewCookies?: boolean }[] = []
let responseText = 'search result'
const handle = async (options: { url: string; method?: string; data?: string; bridge?: string; headers?: Record<string, string>; webViewCookies?: boolean }) => {
  const method = options.method ?? 'GET'
  requests.push({ ...options, method })
  if (options.url.endsWith('/search')) return { status: redirect, headers: { location: redirectLocation }, data: '' }
  return { status: 200, headers: { 'content-type': 'text/html' }, data: Buffer.from(responseText).toString('base64') }
}
Object.assign(globalThis, { __catalogDirectBridge: {
  request: (options: Record<string, unknown>) => handle({ ...options, bridge: 'okhttp' } as never),
  get: (options: Record<string, unknown>) => handle({ ...options, method: 'GET', bridge: 'capacitor' } as never),
  post: (options: Record<string, unknown>) => handle({ ...options, method: 'POST', bridge: 'capacitor' } as never),
} })
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@capacitor/core') return { url: 'file:///catalog-test-capacitor.mjs', shortCircuit: true }
    if (specifier === '@capacitor/network') return { url: 'file:///catalog-test-network.mjs', shortCircuit: true }
    return nextResolve(specifier, context)
  },
  load(url, context, nextLoad) {
    if (url === 'file:///catalog-test-capacitor.mjs') return { format: 'module', shortCircuit: true, source: 'export const Capacitor = {isNativePlatform:()=>true,getPlatform:()=>"android"}; export const CapacitorHttp=globalThis.__catalogDirectBridge; export function registerPlugin(){return globalThis.__catalogDirectBridge}' }
    if (url === 'file:///catalog-test-network.mjs') return { format: 'module', shortCircuit: true, source: 'export const Network = {}' }
    return nextLoad(url, context)
  },
})
const { fetchAbsoluteText, fetchAbsoluteFormPost, setRuntimeProxyPrefs } = await import('../src/lib/http')
const { catalogUserAgent } = await import('../src/features/siteCatalog/requestIdentity')
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
requests.length = 0
redirect = 302
redirectLocation = 'http://example.test/results'
assert.equal(await fetchAbsoluteText('https://example.test/search'), 'search result')
assert.deepEqual(requests.map(({url}) => url), [
  'https://example.test/search',
  'http://example.test/results',
], 'GET redirect must retain the server-specified scheme')
requests.length = 0
redirectLocation = 'javascript:alert(1)'
await assert.rejects(fetchAbsoluteText('https://example.test/search'), /不支持的重定向协议/)
assert.equal(requests.length, 1, 'never visit a non-http redirect target')

setRuntimeProxyPrefs({ mode: 'off', proxyUrl: '', customBypassDomains: [], customProxyDomains: [] })
requests.length = 0
redirectLocation = '/results'
await fetchAbsoluteText('https://example.test/search', { nativeTransport: 'okhttp', userAgent: 'catalog-test-ua' })
assert.deepEqual(requests.map(({bridge}) => bridge), ['okhttp', 'okhttp'], 'direct catalog GET and redirects must use OkHttp, matching the working Android transport')
assert.equal(requests[0].headers?.['User-Agent'], 'catalog-test-ua')
assert.ok(requests.every((request) => request.webViewCookies === true), 'CMS redirects retain WebView cookies')
requests.length = 0
await fetchAbsoluteFormPost('https://example.test/search', { q: '中文' }, { nativeTransport: 'okhttp' })
assert.deepEqual(requests.map(({bridge}) => bridge), ['okhttp', 'okhttp'], 'catalog POST must keep its transport after a GET redirect')
assert.ok(requests.every((request) => request.webViewCookies === true), 'CMS POST and GET share the cookie policy')
requests.length = 0
await fetchAbsoluteText('https://example.test/results')
assert.equal(requests[0].bridge, 'capacitor', 'ordinary reading retains its existing native transport')

const { loadCatalogPage } = await import('../src/features/siteCatalog/service')
const source = { id: 'custom_native', name: '测试目录', label: '目录', group: 'custom' as const, kind: 'web-catalog' as const, enabled: true, url: 'https://example.test/catalog', userAgent: 'catalog-test-ua' }
requests.length = 0
responseText = '<main><article><h2><a href="/posts/entry">Test catalog entry</a></h2></article></main>'
const page = await loadCatalogPage(source, { method: 'GET', url: source.url })
assert.equal(page.articles.length, 1)
assert.equal(requests[0].bridge, 'okhttp', 'catalog service must opt into the working direct transport')
assert.equal(requests[0].headers?.['User-Agent'], source.userAgent)

const { resolveArticleBody } = await import('../src/lib/resolveBody')
requests.length = 0
await resolveArticleBody({ ...page.articles[0], contentType: 'video' }, undefined, [source])
assert.equal(requests[0].bridge, 'okhttp', 'catalog detail pages must keep the same native transport')
assert.equal(requests[0].headers?.['User-Agent'], source.userAgent)
assert.equal(requests[0].webViewCookies, true)

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const webviewAgent = 'Mozilla/5.0 (Linux; Android 16; Pixel 10 Pro; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.0.0 Mobile Safari/537.36'
try {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: webviewAgent } })
  assert.match(catalogUserAgent(), /Android 16/)
  assert.doesNotMatch(catalogUserAgent(), /(?:; wv|Version\/4\.0)/)
  assert.equal(catalogUserAgent('site-custom-ua'), 'site-custom-ua', 'explicit source UA takes priority')
} finally {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  else Reflect.deleteProperty(globalThis, 'navigator')
}
console.log('site catalog native POST, GET redirects and browser-compatible identity: ok')
