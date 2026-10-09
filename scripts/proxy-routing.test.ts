import assert from 'node:assert/strict'
import {
  parseProxyAddress,
  shouldUseProxy,
  wrapProxiedUrl,
} from '../src/features/proxy/service'
import { buildProxyUri, planNodeUpstream } from '../src/features/proxy/nodeAgent'
import {
  browserTunnelUnsupportedReason,
  resolveProxyTransport,
} from '../src/features/proxy/transport'
import type { ProxyPrefs } from '../src/features/proxy/types'

console.log('--- 测试 1: 代理地址解析 ---')

// HTTP 地址
const httpProxy = parseProxyAddress('http://127.0.0.1:7890')
assert.equal(httpProxy.isValid, true)
assert.equal(httpProxy.protocol, 'http')
assert.equal(httpProxy.host, '127.0.0.1')
assert.equal(httpProxy.port, 7890)

// SOCKS5 地址
const socksProxy = parseProxyAddress('socks5://user:pass@proxy.example.com:1080')
assert.equal(socksProxy.isValid, true)
assert.equal(socksProxy.protocol, 'socks5')
assert.equal(socksProxy.host, 'proxy.example.com')
assert.equal(socksProxy.port, 1080)
assert.equal(socksProxy.username, 'user')
assert.equal(socksProxy.password, 'pass')

// 无协议头的 host:port
const implicitHttp = parseProxyAddress('127.0.0.1:8888')
assert.equal(implicitHttp.isValid, true)
assert.equal(implicitHttp.protocol, 'http')
assert.equal(implicitHttp.host, '127.0.0.1')
assert.equal(implicitHttp.port, 8888)

// Web 反向代理 URL 模式
const webProxy1 = parseProxyAddress('https://proxy.example.com/?url=')
assert.equal(webProxy1.isValid, true)
assert.equal(webProxy1.protocol, 'web')

const webProxy2 = parseProxyAddress('https://my-proxy.org/relay?target=%s')
assert.equal(webProxy2.isValid, true)
assert.equal(webProxy2.protocol, 'web')

console.log('✓ 代理地址解析测试通过')

console.log('--- 测试 2: 智能分流与规则判定 ---')

const testPrefs: ProxyPrefs = {
  mode: 'auto',
  proxyUrl: 'https://proxy.example.com/?url=',
  customBypassDomains: ['bypass-news.com'],
  customProxyDomains: ['force-proxy.cn'],
}

// 国际源应该走代理
assert.equal(
  shouldUseProxy('https://feeds.bbci.co.uk/news/rss.xml', { id: 'bbc-zh', group: 'intl' }, testPrefs),
  true,
)
assert.equal(
  shouldUseProxy('https://news.google.com/rss', { id: 'gnews-world' }, testPrefs),
  true,
)
assert.equal(
  shouldUseProxy('https://news.ycombinator.com/rss', { id: 'hn' }, testPrefs),
  true,
)

// 国内源应该直连（不走代理）
assert.equal(
  shouldUseProxy('https://3g.163.com/touch/reconstruct/article/list/BBM54PGAwangning/0-10.html', { id: 'netease-hot', group: 'hot' }, testPrefs),
  false,
)
assert.equal(
  shouldUseProxy('https://sspai.com/api/v1/article/tag/page/get', { id: 'sspai', group: 'tech' }, testPrefs),
  false,
)

// 自定义强制代理白名单
assert.equal(
  shouldUseProxy('https://force-proxy.cn/feed.xml', undefined, testPrefs),
  true,
)

// 自定义直连白名单
assert.equal(
  shouldUseProxy('https://bypass-news.com/feed.xml', { id: 'bbc-zh', group: 'intl' }, testPrefs),
  false,
)

// 全局代理模式
const alwaysPrefs: ProxyPrefs = { ...testPrefs, mode: 'always' }
assert.equal(
  shouldUseProxy('https://3g.163.com/news', { id: 'netease-hot' }, alwaysPrefs),
  true,
)

// 直连关闭模式
const offPrefs: ProxyPrefs = { ...testPrefs, mode: 'off' }
assert.equal(
  shouldUseProxy('https://feeds.bbci.co.uk/news/rss.xml', { id: 'bbc-zh', group: 'intl' }, offPrefs),
  false,
)

console.log('✓ 智能分流与规则判定测试通过')

console.log('--- 测试 3: Web 代理 URL 包装转换 ---')

const target = 'https://feeds.bbci.co.uk/news/rss.xml'
const wrapped1 = wrapProxiedUrl(target, {
  mode: 'auto',
  proxyUrl: 'https://proxy.example.com/?url=',
  customBypassDomains: [],
  customProxyDomains: [],
})
assert.equal(wrapped1, `https://proxy.example.com/?url=${encodeURIComponent(target)}`)

const wrapped2 = wrapProxiedUrl(target, {
  mode: 'auto',
  proxyUrl: 'https://proxy.example.com/relay?target=%s',
  customBypassDomains: [],
  customProxyDomains: [],
})
assert.equal(wrapped2, `https://proxy.example.com/relay?target=${encodeURIComponent(target)}`)

console.log('✓ Web 代理 URL 包装转换测试通过')

console.log('--- 测试 4: resolveProxyTransport 运行时矩阵 ---')

const bbc = 'https://feeds.bbci.co.uk/news/rss.xml'
const webPrefs: ProxyPrefs = {
  mode: 'auto',
  proxyUrl: 'https://proxy.example.com/?url=',
  customBypassDomains: [],
  customProxyDomains: [],
}
const socksPrefs: ProxyPrefs = {
  mode: 'auto',
  proxyUrl: 'socks5://127.0.0.1:7890',
  customBypassDomains: [],
  customProxyDomains: [],
}
const httpPrefs: ProxyPrefs = {
  mode: 'auto',
  proxyUrl: 'http://127.0.0.1:7890',
  customBypassDomains: [],
  customProxyDomains: [],
}
const meta = { id: 'bbc-zh', group: 'intl' as const }

const webNative = resolveProxyTransport(bbc, meta, webPrefs, { native: true, dev: false })
assert.equal(webNative.kind, 'web-wrap')
assert.equal(webNative.requestUrl, `https://proxy.example.com/?url=${encodeURIComponent(bbc)}`)

const webBrowser = resolveProxyTransport(bbc, meta, webPrefs, { native: false, dev: false })
assert.equal(webBrowser.kind, 'web-wrap')

const socksNative = resolveProxyTransport(bbc, meta, socksPrefs, { native: true, dev: false })
assert.equal(socksNative.kind, 'native-tunnel')
assert.equal(socksNative.requestUrl, bbc)
assert.deepEqual(socksNative.tunnel, {
  type: 'socks5',
  host: '127.0.0.1',
  port: 7890,
  username: undefined,
  password: undefined,
})

const socksDev = resolveProxyTransport(bbc, meta, socksPrefs, { native: false, dev: true })
assert.equal(socksDev.kind, 'dev-vite')
assert.ok(socksDev.tunnel)

const socksProdWeb = resolveProxyTransport(bbc, meta, socksPrefs, { native: false, dev: false })
assert.equal(socksProdWeb.kind, 'unsupported')
assert.match(socksProdWeb.reason ?? '', /Android App/)

const httpNative = resolveProxyTransport(bbc, meta, httpPrefs, { native: true, dev: false })
assert.equal(httpNative.kind, 'native-tunnel')
assert.equal(httpNative.tunnel?.type, 'http')

const cnDirect = resolveProxyTransport(
  'https://3g.163.com/news',
  { id: 'netease-hot', group: 'hot' },
  socksPrefs,
  { native: true, dev: false },
)
assert.equal(cnDirect.kind, 'direct')

assert.equal(
  browserTunnelUnsupportedReason(socksPrefs, { native: false, dev: false }),
  '此协议仅 Android App 可用；网页请用 Web 反向代理或系统 VPN',
)
assert.equal(browserTunnelUnsupportedReason(socksPrefs, { native: false, dev: true }), null)
assert.equal(browserTunnelUnsupportedReason(socksPrefs, { native: true, dev: false }), null)
assert.equal(browserTunnelUnsupportedReason(webPrefs, { native: false, dev: false }), null)

console.log('✓ resolveProxyTransport 运行时矩阵测试通过')

console.log('--- 测试 5: Node 上游 plan / proxy URI ---')

const socksParsed = parseProxyAddress('socks5://user:pass@127.0.0.1:7890')
assert.equal(buildProxyUri(socksParsed), 'socks5h://user:pass@127.0.0.1:7890')

const httpParsed = parseProxyAddress('http://127.0.0.1:7890')
assert.equal(buildProxyUri(httpParsed), 'http://127.0.0.1:7890')

const planSocks = planNodeUpstream(bbc, socksPrefs, meta)
assert.equal(planSocks.viaUserProxy, true)
assert.equal(planSocks.url, bbc)
assert.equal(planSocks.proxyUri, 'socks5h://127.0.0.1:7890')

const planWeb = planNodeUpstream(bbc, webPrefs, meta)
assert.equal(planWeb.viaUserProxy, true)
assert.equal(planWeb.proxyUri, null)
assert.equal(planWeb.url, `https://proxy.example.com/?url=${encodeURIComponent(bbc)}`)

const planDirect = planNodeUpstream(
  'https://3g.163.com/news',
  socksPrefs,
  { id: 'netease-hot', group: 'hot' },
)
assert.equal(planDirect.viaUserProxy, false)
assert.equal(planDirect.proxyUri, null)

console.log('✓ Node 上游 plan 测试通过')
console.log('所有代理测试全部通过！')
