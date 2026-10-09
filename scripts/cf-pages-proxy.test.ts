import assert from 'node:assert/strict'
import { onRequest } from '../functions/api/[[path]].ts'

console.log('--- 测试 1: OPTIONS 预检请求与 CORS 响应头 ---')
{
  const req = new Request('https://news.aizeek.com/api/feed/netease', { method: 'OPTIONS' })
  const res = await onRequest({
    request: req,
    params: { path: ['feed', 'netease'] },
    functionPath: '/api/feed/netease',
    waitUntil: () => {},
    next: async () => new Response(),
    env: {},
    data: {},
  })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*')
  assert.match(res.headers.get('Access-Control-Allow-Methods') ?? '', /GET/)
  console.log('✓ OPTIONS 预检请求测试通过')
}

console.log('--- 测试 2: /api/dev-proxy-prefs 兼容响应 ---')
{
  const req = new Request('https://news.aizeek.com/api/dev-proxy-prefs', { method: 'POST' })
  const res = await onRequest({
    request: req,
    params: { path: ['dev-proxy-prefs'] },
    functionPath: '/api/dev-proxy-prefs',
    waitUntil: () => {},
    next: async () => new Response(),
    env: {},
    data: {},
  })
  assert.equal(res.status, 204)
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*')
  console.log('✓ dev-proxy-prefs 测试通过')
}

console.log('--- 测试 3: /api/feed/:id 路由与信源匹配 ---')
{
  // 未知信源
  const reqUnknown = new Request('https://news.aizeek.com/api/feed/non-existent-source')
  const resUnknown = await onRequest({
    request: reqUnknown,
    params: { path: ['feed', 'non-existent-source'] },
    functionPath: '/api/feed/non-existent-source',
    waitUntil: () => {},
    next: async () => new Response(),
    env: {},
    data: {},
  })
  assert.equal(resUnknown.status, 404)
  assert.match(await resUnknown.text(), /Unknown source/)

  // 模拟 global fetch 捕获请求参数
  const originalFetch = globalThis.fetch
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedInit = init
      return new Response(JSON.stringify({ code: 200, data: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch

    // 正常信源（网易）
    const reqNetease = new Request('https://news.aizeek.com/api/feed/netease')
    const resNetease = await onRequest({
      request: reqNetease,
      params: { path: ['feed', 'netease'] },
      functionPath: '/api/feed/netease',
      waitUntil: () => {},
      next: async () => new Response(),
      env: {},
      data: {},
    })

    assert.equal(resNetease.status, 200)
    assert.equal(resNetease.headers.get('Access-Control-Allow-Origin'), '*')
    assert.match(capturedUrl, /163\.com/)
    const headersObj = capturedInit?.headers as Record<string, string>
    assert.equal(headersObj['User-Agent'], 'NewsApp')

    // 分页 POST 信源（晚点）
    const reqLatepost = new Request('https://news.aizeek.com/api/feed/latepost?page=2', {
      method: 'POST',
    })
    const resLatepost = await onRequest({
      request: reqLatepost,
      params: { path: ['feed', 'latepost'] },
      functionPath: '/api/feed/latepost',
      waitUntil: () => {},
      next: async () => new Response(),
      env: {},
      data: {},
    })
    assert.equal(resLatepost.status, 200)
    assert.equal(capturedInit?.method, 'POST')
    assert.match(String(capturedInit?.body), /limit=/)

    // JSON POST 信源（澎湃）：代理必须保留 application/json 与结构化 body。
    const reqThePaper = new Request('https://news.aizeek.com/api/feed/thepaper-bookreview?page=0', {
      method: 'POST',
    })
    const resThePaper = await onRequest({
      request: reqThePaper,
      params: { path: ['feed', 'thepaper-bookreview'] },
      functionPath: '/api/feed/thepaper-bookreview',
      waitUntil: () => {},
      next: async () => new Response(),
      env: {},
      data: {},
    })
    assert.equal(resThePaper.status, 200)
    assert.equal(capturedInit?.method, 'POST')
    const paperHeaders = capturedInit?.headers as Record<string, string>
    assert.match(paperHeaders['Content-Type'] ?? '', /application\/json/i)
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), {
      nodeId: 26878,
      pageNum: 1,
      pageSize: 20,
    })

    const paperCursorBody = {
      nodeId: 26878,
      pageNum: 2,
      pageSize: 20,
      startTime: 1788837532062,
      excludeContIds: ['34000000'],
    }
    const reqThePaperPage2 = new Request(
      'https://news.aizeek.com/api/feed/thepaper-bookreview',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(paperCursorBody),
      },
    )
    await onRequest({
      request: reqThePaperPage2,
      params: { path: ['feed', 'thepaper-bookreview'] },
      functionPath: '/api/feed/thepaper-bookreview',
      waitUntil: () => {},
      next: async () => new Response(),
      env: {},
      data: {},
    })
    assert.deepEqual(JSON.parse(String(capturedInit?.body)), paperCursorBody)

    // 南方周末：移动 UA 会被官网 302 到失效的 /wap/#/... 路由，代理必须使用桌面 UA。
    const reqInfzm = new Request('https://news.aizeek.com/api/feed/infzm-depth')
    const resInfzm = await onRequest({
      request: reqInfzm,
      params: { path: ['feed', 'infzm-depth'] },
      functionPath: '/api/feed/infzm-depth',
      waitUntil: () => {},
      next: async () => new Response(),
      env: {},
      data: {},
    })
    assert.equal(resInfzm.status, 200)
    assert.match(capturedUrl, /infzm\.com\/contents\?term_id=202/)
    const infzmHeaders = capturedInit?.headers as Record<string, string>
    assert.match(infzmHeaders['User-Agent'] ?? '', /Windows NT 10\.0/)
    assert.doesNotMatch(infzmHeaders['User-Agent'] ?? '', /Mobile|Android/i)
  } finally {
    globalThis.fetch = originalFetch
  }
  console.log('✓ /api/feed 路由及参数解析测试通过')
}

console.log('--- 测试 4: /api/page 正文抓取代理 ---')
{
  const originalFetch = globalThis.fetch
  let capturedUrl = ''
  let capturedHeaders: Record<string, string> = {}

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input)
      capturedHeaders = (init?.headers as Record<string, string>) || {}
      return new Response('<html><body><h1>Hello News</h1></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      })
    }) as typeof fetch

    const reqPage = new Request('https://news.aizeek.com/api/page?url=https%3A%2F%2Fexample.com%2Fnews%2F123')
    const resPage = await onRequest({
      request: reqPage,
      params: { path: ['page'] },
      functionPath: '/api/page',
      waitUntil: () => {},
      next: async () => new Response(),
      env: {},
      data: {},
    })

    assert.equal(resPage.status, 200)
    assert.equal(resPage.headers.get('Access-Control-Allow-Origin'), '*')
    assert.equal(capturedUrl, 'https://example.com/news/123')
    assert.equal(capturedHeaders.Referer, 'https://example.com/')

    const reqBilibili = new Request(
      'https://news.aizeek.com/api/page?url=https%3A%2F%2Fwww.bilibili.com%2Fvideo%2FBV1TEST123&ua=' +
        encodeURIComponent('Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile Safari/537.36'),
    )
    await onRequest({
      request: reqBilibili,
      params: { path: ['page'] },
      functionPath: '/api/page',
      waitUntil: () => {},
      next: async () => new Response(),
      env: {},
      data: {},
    })
    assert.equal(capturedHeaders.Referer, 'https://www.bilibili.com/')
    assert.match(
      capturedHeaders['User-Agent'] ?? '',
      /Windows NT 10\.0/,
      '服务端抓 Bilibili 页面时不应沿用移动 UA 进入 H5/挑战壳',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
  console.log('✓ /api/page 代理测试通过')
}

console.log('--- 测试 5: /api/image 防盗链 Referer 处理 ---')
{
  const originalFetch = globalThis.fetch
  let capturedWechatHeaders: Record<string, string> = {}
  let capturedOtherHeaders: Record<string, string> = {}
  let capturedNeteaseHeaders: Record<string, string> = {}
  let capturedBilibiliHeaders: Record<string, string> = {}
  let capturedNeteaseUrl = ''

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.includes('qpic.cn')) {
        capturedWechatHeaders = (init?.headers as Record<string, string>) || {}
      } else if (url.includes('126.net')) {
        capturedNeteaseUrl = url
        capturedNeteaseHeaders = (init?.headers as Record<string, string>) || {}
      } else if (url.includes('hdslb.com')) {
        capturedBilibiliHeaders = (init?.headers as Record<string, string>) || {}
      } else {
        capturedOtherHeaders = (init?.headers as Record<string, string>) || {}
      }
      return new Response(new Uint8Array([0xff, 0xd8, 0xff]), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      })
    }) as typeof fetch

    // 微信图床（不能带 Referer）
    const reqWechat = new Request(
      'https://news.aizeek.com/api/image?url=https%3A%2F%2Fmmbiz.qpic.cn%2Fmmbiz_jpg%2Fabc%2F0',
    )
    await onRequest({
      request: reqWechat,
      params: { path: ['image'] },
      functionPath: '/api/image',
      waitUntil: () => {},
      next: async () => new Response(),
      env: {},
      data: {},
    })
    assert.equal(capturedWechatHeaders.Referer, undefined)

    // 普通图床（携带源站 Referer）
    const reqOther = new Request(
      'https://news.aizeek.com/api/image?url=https%3A%2F%2Fcdn.example.com%2Fphoto.jpg',
    )
    await onRequest({
      request: reqOther,
      params: { path: ['image'] },
      functionPath: '/api/image',
      waitUntil: () => {},
      next: async () => new Response(),
      env: {},
      data: {},
    })
    assert.equal(capturedOtherHeaders.Referer, 'https://cdn.example.com/')

    // 网易图片必须升级 HTTPS，并使用网易门户 Referer 绕过 ws.126.net 防盗链。
    const reqNetease = new Request(
      'https://news.aizeek.com/api/image?url=http%3A%2F%2Fdingyue.ws.126.net%2Fcover.jpg',
    )
    await onRequest({
      request: reqNetease,
      params: { path: ['image'] },
      functionPath: '/api/image',
      waitUntil: () => {},
      next: async () => new Response(),
      env: {},
      data: {},
    })
    assert.equal(capturedNeteaseUrl, 'https://dingyue.ws.126.net/cover.jpg')
    assert.equal(capturedNeteaseHeaders.Referer, 'https://www.163.com/')

    const reqBilibili = new Request(
      'https://news.aizeek.com/api/image?url=' +
        encodeURIComponent('https://i1.hdslb.com/bfs/archive/example.jpg'),
    )
    await onRequest({
      request: reqBilibili,
      params: { path: ['image'] },
      functionPath: '/api/image',
      waitUntil: () => {},
      next: async () => new Response(),
      env: {},
      data: {},
    })
    assert.equal(
      capturedBilibiliHeaders.Referer,
      'https://www.bilibili.com/',
      'Bilibili CDN 代理必须使用门户 Referer，而不是 i1.hdslb.com 自身',
    )
  } finally {
    globalThis.fetch = originalFetch
  }
  console.log('✓ /api/image 防盗链策略测试通过')
}

console.log('所有 Cloudflare Pages Functions 代理测试全部通过！')
