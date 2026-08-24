/**
 * 分享深链 `/a/<token>` 的社交卡片：只有爬虫拿 OG HTML，真人仍走 SPA。
 */

import assert from 'node:assert/strict'

import worker, { type Env } from '../functions/worker.ts'
import { encodeShareToken } from '../src/lib/shareToken.ts'

/** 与 index.html 的通用 meta 保持一致：爬虫一旦拿到这段文案，聊天里就是「站点壳」卡片 */
const SITE_SHELL_DESCRIPTION = '有所闻 News Nook，直连原发媒体的沉浸式阅读器。'
const SPA_SHELL = `<!doctype html><html><head><title>有所闻 · News Nook</title><meta name="description" content="${SITE_SHELL_DESCRIPTION}" /></head><body><div id="root"></div></body></html>`

const env: Env = {
  ASSETS: {
    fetch: async () =>
      new Response(SPA_SHELL, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
  },
}

const ctx = { waitUntil: () => {} }

const WHATSAPP_UA = 'WhatsApp/2.23.20.0'
const BROWSER_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

const token = encodeShareToken({
  sourceId: 'sspai',
  originUrl: 'https://sspai.com/post/12345',
})

interface UpstreamHit {
  url: string
  userAgent: string
  referer: string
}

/** 替换全局 fetch，记录每次上游抓取的地址与请求头（UA / Referer） */
async function withUpstream(
  handler: (url: string, hit: UpstreamHit) => Response | Promise<Response>,
  run: (visited: string[], hits: UpstreamHit[]) => Promise<void>,
): Promise<void> {
  const original = globalThis.fetch
  const visited: string[] = []
  const hits: UpstreamHit[] = []
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    const hit: UpstreamHit = {
      url: String(input),
      userAgent: headers.get('user-agent') ?? '',
      referer: headers.get('referer') ?? '',
    }
    visited.push(hit.url)
    hits.push(hit)
    return handler(hit.url, hit)
  }) as typeof fetch
  try {
    await run(visited, hits)
  } finally {
    globalThis.fetch = original
  }
}

function htmlPage(body: string): Response {
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } })
}

function request(path: string, userAgent: string, init?: RequestInit): Request {
  return new Request(`https://news.aizeek.com${path}`, {
    headers: { 'User-Agent': userAgent, ...((init?.headers as Record<string, string>) ?? {}) },
    ...init,
  })
}

console.log('--- 测试 1: 爬虫 UA 拿到带文章信息的 OG 卡片 ---')
await withUpstream(
  () =>
    htmlPage(`<html><head>
      <title>网页标题不该优先</title>
      <meta property="og:title" content="国产大模型价格战再起 &amp; 降价">
      <meta property="og:description" content="几家厂商在同一周把推理价格压到接近成本线。">
      <meta property="og:image" content="/images/cover.jpg">
    </head><body>正文</body></html>`),
  async (visited) => {
    const res = await worker.fetch(request(`/a/${token}`, WHATSAPP_UA), env, ctx)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type') ?? '', /text\/html/)
    assert.match(res.headers.get('vary') ?? '', /User-Agent/i, '同址两种响应，缓存必须按 UA 分开')
    // 文章卡标题不会变，可以放心多缓存一会儿
    assert.match(res.headers.get('cache-control') ?? '', /max-age=3600/, '文章卡应用较长缓存')

    const html = await res.text()
    assert.equal(visited[0], 'https://sspai.com/post/12345', '应服务端直连原文抓 head')
    assert.equal(visited.length, 1, '第一把 UA 就拿到标题时不应重复抓')
    // 上游的 `&amp;` 先还原再统一转义，输出里正好是一层实体，不会变成 `&amp;amp;`
    assert.match(html, /<meta property="og:title" content="国产大模型价格战再起 &amp; 降价">/)
    assert.match(html, /<meta property="og:description" content="几家厂商在同一周把推理价格压到接近成本线。/)
    assert.match(html, /<meta property="og:url" content="https:\/\/news\.aizeek\.com\/a\/[\w-]+">/)
    assert.match(html, /<meta property="og:image" content="https:\/\/sspai\.com\/images\/cover\.jpg">/)
    assert.match(html, /<meta property="og:site_name" content="有所闻 · NewsNook">/)
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/)
    assert.match(html, /<title>国产大模型价格战再起 &amp; 降价 - 有所闻<\/title>/)
    assert.ok(!html.includes('id="root"'), '爬虫不该拿到 SPA 空壳')
    assert.ok(!html.includes(SITE_SHELL_DESCRIPTION), '爬虫不得拿到 index.html 的站点通用文案')

    // 注册表里认识的信源用中文名，方便对方一眼看出出处
    assert.match(html, /原文来自 少数派/)
  },
)
console.log('✓ 爬虫 UA 卡片测试通过')

console.log('--- 测试 1b: 带 salt 的新链接解出同一篇，og:url 指向规范地址 ---')
{
  const saltedToken = encodeShareToken(
    { sourceId: 'sspai', originUrl: 'https://sspai.com/post/12345' },
    { salt: 'z9k2' },
  )
  assert.notEqual(saltedToken, token, 'salt 应让 token 变成另一条 URL')
  await withUpstream(
    () =>
      htmlPage(
        '<html><head><meta property="og:title" content="盐值链接同一篇"></head></html>',
      ),
    async () => {
      const res = await worker.fetch(request(`/a/${saltedToken}`, WHATSAPP_UA), env, ctx)
      const html = await res.text()
      assert.match(html, /og:title" content="盐值链接同一篇"/, '带 salt 的 token 应解出同一篇文章')
      // og:url 用不带 salt 的规范 token，平台按规范地址归并，缓存键不被打散
      assert.match(html, new RegExp(`<meta property="og:url" content="https://news\\.aizeek\\.com/a/${token}">`))
      assert.ok(!html.includes(`og:url" content="https://news.aizeek.com/a/${saltedToken}"`))
      // 逃生门仍回到用户点开的带 salt 地址
      assert.match(html, new RegExp(`refresh" content="0;url=https://news\\.aizeek\\.com/a/${saltedToken}\\?app=1"`))
    },
  )
}
console.log('✓ salt 链接测试通过')

console.log('--- 测试 1c: 浏览器 UA 被拦时换搜索引擎 UA 重试 ---')
await withUpstream(
  (_url, hit) =>
    /Googlebot/i.test(hit.userAgent)
      ? htmlPage('<html><head><meta property="og:title" content="放行爬虫后的真标题"></head></html>')
      : new Response('Forbidden', { status: 403 }),
  async (visited, hits) => {
    const res = await worker.fetch(request(`/a/${token}`, WHATSAPP_UA), env, ctx)
    const html = await res.text()
    assert.equal(visited.length, 2, '第一把被拦后应换 UA 再试一次')
    assert.match(hits[0].userAgent, /Chrome/, '第一把用浏览器 UA')
    assert.match(hits[0].referer, /^https:\/\/sspai\.com\//, '第一把带同站 Referer')
    assert.match(hits[1].userAgent, /Googlebot/, '第二把换搜索引擎 UA')
    assert.equal(hits[1].referer, '', '第二把不带 Referer')
    assert.match(html, /og:title" content="放行爬虫后的真标题"/, '重试拿到的标题应进卡片')
  },
)
console.log('✓ 换 UA 重试测试通过')

console.log('--- 测试 1d: 反爬质询页的标题不进卡片 ---')
await withUpstream(
  () => htmlPage('<html><head><title>Just a moment...</title></head></html>'),
  async (visited) => {
    const res = await worker.fetch(request(`/a/${token}`, WHATSAPP_UA), env, ctx)
    const html = await res.text()
    assert.equal(visited.length, 2, '质询页等同没抓到，应换 UA 再试')
    assert.ok(!html.includes('Just a moment'), '质询页标题不得写进卡片')
    assert.match(html, /<meta property="og:title" content="少数派 · 有所闻分享">/, '兜底标题应带信源名')
  },
)
console.log('✓ 质询页过滤测试通过')

console.log('--- 测试 2: 普通浏览器 UA 仍走 SPA 回退 ---')
await withUpstream(
  () => htmlPage('<html><head><title>不该被抓</title></head></html>'),
  async (visited) => {
    const res = await worker.fetch(request(`/a/${token}`, BROWSER_UA), env, ctx)
    const html = await res.text()
    assert.equal(html, SPA_SHELL, '真人应拿到 SPA 空壳')
    assert.ok(!html.includes('og:title'), '真人页面不应带卡片标签')
    assert.equal(visited.length, 0, '真人访问不应触发服务端抓原文')
  },
)
console.log('✓ 非爬虫 UA 测试通过')

console.log('--- 测试 3: 微信 UA 按 Sec-Fetch 区分抓取与真人导航 ---')
const WECHAT_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 MicroMessenger/8.0.42'
await withUpstream(
  () => htmlPage('<html><head><meta property="og:title" content="微信抓到的标题"></head></html>'),
  async () => {
    const crawled = await worker.fetch(request(`/a/${token}`, WECHAT_UA), env, ctx)
    assert.match(await crawled.text(), /og:title" content="微信抓到的标题"/)

    const navigated = await worker.fetch(
      request(`/a/${token}`, WECHAT_UA, { headers: { 'Sec-Fetch-Mode': 'navigate' } }),
      env,
      ctx,
    )
    assert.equal(await navigated.text(), SPA_SHELL, '微信内置浏览器的真实导航应进 SPA')

    // 抓取端 UA 变体：企业微信 / WeChat / Weixin 也要能拿到文章级卡片
    for (const variant of [
      'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 wxwork/4.1.20',
      'Mozilla/5.0 (compatible; WeChat Crawler)',
      'Weixin Link Preview',
    ]) {
      const res = await worker.fetch(request(`/a/${token}`, variant), env, ctx)
      assert.match(
        await res.text(),
        /og:title" content="微信抓到的标题"/,
        `UA 变体应拿到文章级 og:title：${variant}`,
      )
    }

    // 真人在微信里被误判成爬虫后，逃生门 ?app=1 必须直达 SPA，pathname 上仍有 token
    const escaped = await worker.fetch(request(`/a/${token}?app=1`, WECHAT_UA), env, ctx)
    assert.equal(await escaped.text(), SPA_SHELL, '?app=1 必须直达 SPA，由前端解码 token 进阅读器')
  },
)
console.log('✓ 微信 UA 分流测试通过')

console.log('--- 测试 3b: WhatsApp 桌面端 UA 变体也拿到文章级卡片 ---')
await withUpstream(
  () => htmlPage('<html><head><meta property="og:title" content="WhatsApp 抓到的标题"></head></html>'),
  async () => {
    for (const variant of [
      'WhatsApp/2.2409.2 W',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 WhatsApp/2.23.20.0',
    ]) {
      const res = await worker.fetch(request(`/a/${token}`, variant), env, ctx)
      const html = await res.text()
      assert.match(html, /og:title" content="WhatsApp 抓到的标题"/, `UA 变体应命中卡片：${variant}`)
      // 卡片自身的 og:url 指向不带 ?app=1 的规范地址，平台缓存的是可分享的原链
      assert.match(html, /<meta property="og:url" content="https:\/\/news\.aizeek\.com\/a\/[\w-]+">/)
    }
  },
)
console.log('✓ WhatsApp UA 变体测试通过')

console.log('--- 测试 4: 卡片页的 meta refresh 不会打转 ---')
await withUpstream(
  () => htmlPage('<html><head><title>随便</title></head></html>'),
  async () => {
    const res = await worker.fetch(request(`/a/${token}`, WHATSAPP_UA), env, ctx)
    const bounce = /<meta http-equiv="refresh" content="0;url=([^"]+)">/.exec(await res.text())?.[1]
    assert.ok(bounce, '卡片页应带 meta refresh，误判成爬虫的真人能被送回阅读页')

    const target = new URL(bounce)
    const followed = await worker.fetch(
      request(`${target.pathname}${target.search}`, WHATSAPP_UA),
      env,
      ctx,
    )
    assert.equal(await followed.text(), SPA_SHELL, '跟随 refresh 后应落到 SPA，而不是再来一张卡片')
  },
)
console.log('✓ meta refresh 逃生门测试通过')

console.log('--- 测试 5: token 损坏 / 上游抓不到时退回兜底文案，且兜底卡不缓存 ---')
await withUpstream(
  () => htmlPage('<html><head><title>不该被读到</title></head></html>'),
  async (visited) => {
    const res = await worker.fetch(request('/a/not-a-valid-token', WHATSAPP_UA), env, ctx)
    const html = await res.text()
    assert.equal(res.status, 200)
    // token 解不出来时没有信源信息，只能给通用兜底
    assert.match(html, /<meta property="og:title" content="有所闻分享">/)
    assert.match(html, /<meta property="og:description" content="点击在有所闻中阅读全文">/)
    assert.ok(!html.includes('og:image'), '没抓到首图就不该硬塞占位图')
    assert.ok(!html.includes(SITE_SHELL_DESCRIPTION), '兜底卡也不能是站点通用文案')
    assert.equal(visited.length, 0, 'token 解不出来就不该发起上游请求')
    // 兜底卡不能被缓存钉住，上游恢复后爬虫重抓要立即拿到文章卡
    assert.match(res.headers.get('cache-control') ?? '', /max-age=0/, '兜底卡应立即过期')
    assert.equal(res.headers.get('cdn-cache-control'), 'no-store', '边缘也不缓存兜底卡')
  },
)

await withUpstream(
  () => {
    throw new Error('upstream down')
  },
  async (visited) => {
    const res = await worker.fetch(request(`/a/${token}`, WHATSAPP_UA), env, ctx)
    const html = await res.text()
    assert.equal(visited.length, 2, '两把 UA 都该试过')
    // token 可解时兜底标题带信源名，观感是「这条来自少数派」而不是空话
    assert.match(html, /<meta property="og:title" content="少数派 · 有所闻分享">/)
    assert.match(html, /点击在有所闻中阅读全文 · 原文来自 少数派/, '抓不到正文也该保住出处信息')
    assert.match(res.headers.get('cache-control') ?? '', /max-age=0/, '失败卡不该缓存 10 分钟')
  },
)

await withUpstream(
  () => new Response('boom', { status: 503 }),
  async () => {
    const res = await worker.fetch(request(`/a/${token}`, WHATSAPP_UA), env, ctx)
    assert.match(await res.text(), /<meta property="og:title" content="少数派 · 有所闻分享">/)
  },
)
console.log('✓ 兜底文案测试通过')

console.log('--- 测试 5b: 所有已知抓取端 UA 都拿不到站点通用文案 ---')
await withUpstream(
  () => htmlPage('<html><head><meta property="og:title" content="文章级标题"></head></html>'),
  async () => {
    const crawlerVariants = [
      WHATSAPP_UA,
      'WhatsApp/2.2409.2 W',
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 MicroMessenger/8.0.42',
      'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
      'TelegramBot (like TwitterBot)',
      'Twitterbot/1.0',
      'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
    ]
    for (const ua of crawlerVariants) {
      const res = await worker.fetch(request(`/a/${token}`, ua), env, ctx)
      const html = await res.text()
      assert.ok(
        !html.includes(SITE_SHELL_DESCRIPTION),
        `抓取端不得拿到 index.html 通用文案：${ua}`,
      )
      assert.ok(!html.includes('id="root"'), `抓取端不得拿到 SPA 空壳：${ua}`)
      assert.match(html, /og:title" content="文章级标题"/, `抓取端应拿到文章级 og:title：${ua}`)
    }
  },
)
console.log('✓ 抓取端 UA 回归测试通过')

console.log('--- 测试 6: 上游注入的 XSS 载荷被转义 ---')
await withUpstream(
  () =>
    htmlPage(`<html><head>
      <title>&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;</title>
      <meta property="og:description" content="&lt;img src=x onerror=alert(2)&gt;">
      <meta property="og:image" content="javascript:alert(3)">
    </head></html>`),
  async () => {
    const html = await worker.fetch(request(`/a/${token}`, WHATSAPP_UA), env, ctx).then((r) => r.text())
    assert.ok(!html.includes('<script>'), '标题里的脚本标签必须被转义')
    assert.match(html, /&quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
    assert.match(html, /content="&lt;img src=x onerror=alert\(2\)&gt;/)
    assert.ok(!html.includes('javascript:alert(3)'), '非 http(s) 的 og:image 应被丢掉')

    // 属性边界不能被 `">` 顶开
    const titleMeta = /<meta property="og:title" content="([^"]*)">/.exec(html)
    assert.ok(titleMeta, 'og:title 仍应是一条完整的 meta')
    assert.ok(!titleMeta[1].includes('<'), 'content 里不得残留原始尖括号')
  },
)
console.log('✓ XSS 转义测试通过')

console.log('--- 测试 7: GBK 页面标题不乱码，非 HTML 上游直接放弃 ---')
{
  // 「中文标题」的 GBK 字节，按 UTF-8 解会变成乱码
  const gbkTitle = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4, 0xb1, 0xea, 0xcc, 0xe2])
  const prefix = new TextEncoder().encode('<html><head><meta charset="gbk"><title>')
  const suffix = new TextEncoder().encode('</title></head></html>')
  const page = new Uint8Array([...prefix, ...gbkTitle, ...suffix])

  await withUpstream(
    () => new Response(page, { status: 200, headers: { 'Content-Type': 'text/html' } }),
    async () => {
      const html = await worker.fetch(request(`/a/${token}`, WHATSAPP_UA), env, ctx).then((r) => r.text())
      assert.match(html, /content="中文标题"/)
    },
  )
}

await withUpstream(
  () => new Response('{"a":1}', { status: 200, headers: { 'Content-Type': 'application/json' } }),
  async () => {
    const html = await worker.fetch(request(`/a/${token}`, WHATSAPP_UA), env, ctx).then((r) => r.text())
    assert.match(html, /<meta property="og:title" content="少数派 · 有所闻分享">/, '非 HTML 上游应退回兜底文案')
  },
)
console.log('✓ 编码与内容类型测试通过')

console.log('--- 测试 8: 其它路径不受影响 ---')
await withUpstream(
  () => htmlPage('<html></html>'),
  async (visited) => {
    const home = await worker.fetch(request('/', WHATSAPP_UA), env, ctx)
    assert.equal(await home.text(), SPA_SHELL, '首页对爬虫也只给 SPA')

    const nested = await worker.fetch(request(`/a/${token}/extra`, WHATSAPP_UA), env, ctx)
    assert.equal(await nested.text(), SPA_SHELL, '多段路径不是分享深链')
    assert.equal(visited.length, 0)
  },
)
console.log('✓ 路径边界测试通过')

console.log('分享卡片（Open Graph）测试全部通过！')
