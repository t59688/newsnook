import assert from 'node:assert/strict'

import { DeepLXProvider } from '../src/features/translation/providers'
import {
  configureDeepLxThrottleForTests,
  deepLxBackoffMs,
  isTranslationRateLimitError,
  parseRetryAfterMs,
} from '../src/features/translation/rateLimit'

// 测试用小步节流：验证行为本身，避免真实退避拖慢用例
const TEST_MIN_INTERVAL = 40
const TEST_BACKOFF_BASE = 80
// 公共网关档位（api.deeplx.org）：更大间隔、仅 1 次重试
const TEST_PUBLIC_MIN_INTERVAL = 120
configureDeepLxThrottleForTests(
  {
    minIntervalMs: TEST_MIN_INTERVAL,
    backoffBaseMs: TEST_BACKOFF_BASE,
    backoffMaxMs: 400,
    jitterMaxMs: 0,
    maxRetries: 3,
  },
  {
    minIntervalMs: TEST_PUBLIC_MIN_INTERVAL,
    backoffBaseMs: TEST_BACKOFF_BASE,
    backoffMaxMs: 400,
    jitterMaxMs: 0,
    maxRetries: 1,
  },
)

// 1. 测试连接（单段文本）只发一个请求；空令牌不发送 Authorization；auto 不带 source_lang
{
  const calls: { url: string; body: Record<string, unknown>; authorization: string | null }[] = []
  globalThis.fetch = async (input, init) => {
    const headers = new Headers(init?.headers)
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      authorization: headers.get('Authorization'),
    })
    return Response.json({ code: 200, data: '世界充满故事。' })
  }

  const provider = new DeepLXProvider({
    apiKey: '',
    endpoint: 'https://case1.example/path-token/translate',
  })
  const results = await provider.translate({
    texts: ['The world is full of stories.'],
    sourceLanguage: 'auto',
    targetLanguage: 'zh-Hans',
  })

  assert.deepEqual(results, ['世界充满故事。'])
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://case1.example/path-token/translate')
  assert.equal(calls[0].authorization, null)
  assert.deepEqual(calls[0].body, {
    text: 'The world is full of stories.',
    target_lang: 'ZH',
  })
}

// 2. HTTP 429 自动退避重试（Bearer 令牌照常携带；等待不少于退避基准）
{
  let callCount = 0
  const startTimes: number[] = []
  let authorization: string | null = null
  globalThis.fetch = async (_input, init) => {
    startTimes.push(Date.now())
    callCount += 1
    authorization = new Headers(init?.headers).get('Authorization')
    if (callCount === 1) {
      return Response.json({ code: 429, message: 'Too many requests' }, { status: 429 })
    }
    return Response.json({ code: 200, data: '测试译文' })
  }

  const provider = new DeepLXProvider({
    apiKey: 'placeholder-token',
    endpoint: 'https://case2.example/translate',
    concurrency: 1,
  })
  const results = await provider.translate({
    texts: ['Hello World'],
    sourceLanguage: 'auto',
    targetLanguage: 'zh-Hans',
  })

  assert.deepEqual(results, ['测试译文'])
  assert.equal(callCount, 2)
  assert.equal(authorization, 'Bearer placeholder-token')
  const waited = startTimes[1] - startTimes[0]
  assert.ok(waited >= TEST_BACKOFF_BASE - 10, `429 退避等待过短：${waited}ms`)
}

// 3. 兼容旧行为：HTTP 200 但 body code=429 同样触发退避重试
{
  let callCount = 0
  globalThis.fetch = async () => {
    callCount += 1
    if (callCount === 1) {
      return Response.json({ code: 429, message: 'Too Many Requests' }, { status: 200 })
    }
    return Response.json({ code: 200, data: '测试译文' })
  }

  const provider = new DeepLXProvider({
    apiKey: '',
    endpoint: 'https://case3.example/translate',
    concurrency: 1,
  })
  const results = await provider.translate({
    texts: ['Hello World'],
    sourceLanguage: 'auto',
    targetLanguage: 'zh-Hans',
  })

  assert.deepEqual(results, ['测试译文'])
  assert.equal(callCount, 2)
}

// 4. 持续 429：重试耗尽后抛出限流错误，总请求数 = 1 + maxRetries
{
  let callCount = 0
  globalThis.fetch = async () => {
    callCount += 1
    return Response.json({ code: 429, message: 'Too many requests' }, { status: 429 })
  }

  const provider = new DeepLXProvider({
    apiKey: '',
    endpoint: 'https://case4.example/translate',
    concurrency: 1,
  })
  await assert.rejects(
    () =>
      provider.translate({
        texts: ['Hello World'],
        sourceLanguage: 'auto',
        targetLanguage: 'zh-Hans',
      }),
    (error: unknown) => {
      assert.ok(isTranslationRateLimitError(error), '应抛出限流错误')
      assert.match((error as Error).message, /429/)
      return true
    },
  )
  assert.equal(callCount, 4)
}

// 5. Retry-After 响应头优先于指数退避
{
  let callCount = 0
  const startTimes: number[] = []
  globalThis.fetch = async () => {
    startTimes.push(Date.now())
    callCount += 1
    if (callCount === 1) {
      return Response.json(
        { code: 429, message: 'Too many requests' },
        { status: 429, headers: { 'Retry-After': '1' } },
      )
    }
    return Response.json({ code: 200, data: '测试译文' })
  }

  const provider = new DeepLXProvider({
    apiKey: '',
    endpoint: 'https://case5.example/translate',
    concurrency: 1,
  })
  const results = await provider.translate({
    texts: ['Hello World'],
    sourceLanguage: 'auto',
    targetLanguage: 'zh-Hans',
  })

  assert.deepEqual(results, ['测试译文'])
  const waited = startTimes[1] - startTimes[0]
  assert.ok(waited >= 950, `应按 Retry-After 等待约 1 秒，实际 ${waited}ms`)
}

// 6. 纯函数：Retry-After 解析与退避计算（当前测试配置 jitter=0）
{
  assert.equal(parseRetryAfterMs('2'), 2000)
  assert.equal(parseRetryAfterMs('999999'), 60_000)
  assert.equal(parseRetryAfterMs('abc'), undefined)
  assert.equal(parseRetryAfterMs(undefined), undefined)
  assert.equal(parseRetryAfterMs(null), undefined)
  const fromDate = parseRetryAfterMs(new Date(Date.now() + 5000).toUTCString())
  assert.ok(fromDate !== undefined && fromDate > 2000 && fromDate <= 5000, `HTTP 日期解析异常：${fromDate}`)

  assert.equal(deepLxBackoffMs(0), TEST_BACKOFF_BASE)
  assert.equal(deepLxBackoffMs(1), TEST_BACKOFF_BASE * 2)
  assert.equal(deepLxBackoffMs(10), 400) // 封顶 backoffMaxMs
  assert.equal(deepLxBackoffMs(0, 1000), 1000) // Retry-After 优先
}

// 7. 单段模式合并批：多段按换行合并成一个请求，译文按换行拆回并保持顺序
{
  const bodies: { text: string }[] = []
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { text: string }
    bodies.push(body)
    const translated = body.text
      .split('\n')
      .map((line) => `LX:${line}`)
      .join('\n')
    return Response.json({ code: 200, data: translated })
  }

  const provider = new DeepLXProvider({
    apiKey: '',
    endpoint: 'https://case7.example/translate',
  })
  const batches: { startIndex: number; translations: string[] }[] = []
  const results = await provider.translate({
    texts: ['a', 'b', 'c', 'd'],
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
    onBatch: (batchTranslations, startIndex) => {
      batches.push({ startIndex, translations: batchTranslations })
    },
  })

  assert.deepEqual(results, ['LX:a', 'LX:b', 'LX:c', 'LX:d'])
  assert.equal(bodies.length, 1, '四段短文本应合并为一个请求')
  assert.equal(bodies[0].text, 'a\nb\nc\nd')
  assert.deepEqual(batches, [
    { startIndex: 0, translations: ['LX:a', 'LX:b', 'LX:c', 'LX:d'] },
  ])
}

// 8. 节流门跨 Provider 实例共享（信息流管道 + 测试连接同时进行也不齐射）
{
  const startTimes: number[] = []
  globalThis.fetch = async (_input, init) => {
    startTimes.push(Date.now())
    const body = JSON.parse(String(init?.body)) as { text: string }
    return Response.json({ code: 200, data: `LX:${body.text}` })
  }

  const config = { apiKey: '', endpoint: 'https://case8.example/translate' }
  const providerA = new DeepLXProvider(config)
  const providerB = new DeepLXProvider(config)
  await Promise.all([
    providerA.translate({ texts: ['one'], sourceLanguage: 'en', targetLanguage: 'zh-Hans' }),
    providerB.translate({ texts: ['two'], sourceLanguage: 'en', targetLanguage: 'zh-Hans' }),
  ])

  assert.equal(startTimes.length, 2)
  const gap = Math.abs(startTimes[1] - startTimes[0])
  assert.ok(gap >= TEST_MIN_INTERVAL - 20, `跨实例请求间隔过小：${gap}ms`)
}

// 9. /v2/translate 官方兼容模式：批量打包保留，429 同样退避重试
{
  let callCount = 0
  globalThis.fetch = async (_input, init) => {
    callCount += 1
    const body = JSON.parse(String(init?.body)) as { text: string[] }
    assert.ok(Array.isArray(body.text))
    assert.equal(body.text.length, 2)
    if (callCount === 1) {
      return Response.json({ code: 429, message: 'Too many requests' }, { status: 429 })
    }
    return Response.json({
      code: 200,
      translations: body.text.map((t: string) => ({ text: `译:${t}` })),
    })
  }

  const v2Provider = new DeepLXProvider({
    apiKey: '',
    endpoint: 'https://case9.example/v2/translate',
  })
  const v2Results = await v2Provider.translate({
    texts: ['Item 1', 'Item 2'],
    sourceLanguage: 'auto',
    targetLanguage: 'zh-Hans',
  })

  assert.deepEqual(v2Results, ['译:Item 1', '译:Item 2'])
  assert.equal(callCount, 2)
}

// 10. 退避等待期间取消：立刻以 AbortError 结束，不再发出请求
{
  const controller = new AbortController()
  let callCount = 0
  globalThis.fetch = async () => {
    callCount += 1
    controller.abort()
    return Response.json({ code: 429, message: 'Too many requests' }, { status: 429 })
  }

  const provider = new DeepLXProvider({
    apiKey: '',
    endpoint: 'https://case10.example/translate',
    concurrency: 1,
  })
  await assert.rejects(
    () =>
      provider.translate({
        texts: ['Hello World'],
        sourceLanguage: 'auto',
        targetLanguage: 'zh-Hans',
        signal: controller.signal,
      }),
    (error: unknown) => error instanceof DOMException && error.name === 'AbortError',
  )
  assert.equal(callCount, 1)
}

// 11. 合并批按段数与字符数分批：超过上限时拆成多个请求
{
  const bodies: { text: string }[] = []
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { text: string }
    bodies.push(body)
    const translated = body.text
      .split('\n')
      .map((line) => `译${line.length}`)
      .join('\n')
    return Response.json({ code: 200, data: translated })
  }

  const provider = new DeepLXProvider({
    apiKey: '',
    endpoint: 'https://case11.example/translate',
  })

  // 12 段短文本：按每批 10 段拆成 10 + 2
  const manyTexts = Array.from({ length: 12 }, (_, i) => `t${i}`)
  const manyResults = await provider.translate({
    texts: manyTexts,
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
  })
  assert.equal(manyResults.length, 12)
  assert.equal(bodies.length, 2)
  assert.equal(bodies[0].text.split('\n').length, 10)
  assert.equal(bodies[1].text.split('\n').length, 2)

  // 两段各 700 字符：合计超过 1200 字符上限，各自独立成请求
  bodies.length = 0
  const longA = 'a'.repeat(700)
  const longB = 'b'.repeat(700)
  await provider.translate({
    texts: [longA, longB],
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
  })
  assert.equal(bodies.length, 2, '超出字符预算的段落不应合并')
  assert.equal(bodies[0].text, longA)
  assert.equal(bodies[1].text, longB)
}

// 12. 合并批译文行数不匹配：回退为逐段请求，结果仍按原顺序对齐
{
  const bodies: { text: string }[] = []
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { text: string }
    bodies.push(body)
    if (body.text.includes('\n')) {
      // 模拟上游合并了段落：返回行数与请求不一致
      return Response.json({ code: 200, data: '合并成了一行' })
    }
    return Response.json({ code: 200, data: `单:${body.text}` })
  }

  const provider = new DeepLXProvider({
    apiKey: '',
    endpoint: 'https://case12.example/translate',
  })
  const results = await provider.translate({
    texts: ['first', 'second', 'third'],
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
  })

  assert.deepEqual(results, ['单:first', '单:second', '单:third'])
  // 1 个合并请求 + 3 个逐段回退请求
  assert.equal(bodies.length, 4)
}

// 13. 段内换行压平为空格（HTML 渲染等价），不会破坏合并批的换行分隔
{
  const bodies: { text: string }[] = []
  globalThis.fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { text: string }
    bodies.push(body)
    const translated = body.text
      .split('\n')
      .map((line) => `L:${line}`)
      .join('\n')
    return Response.json({ code: 200, data: translated })
  }

  const provider = new DeepLXProvider({
    apiKey: '',
    endpoint: 'https://case13.example/translate',
  })
  const results = await provider.translate({
    texts: ['first line\n  wrapped', 'plain', '', '  '],
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
  })

  assert.equal(bodies.length, 1)
  assert.equal(bodies[0].text, 'first line wrapped\nplain')
  // 空白文本不发请求、原样返回空串
  assert.deepEqual(results, ['L:first line wrapped', 'L:plain', '', ''])
}

// 14. 端点归一化：路径未以 /translate 结尾时自动补全（路径令牌网关常见漏写）
{
  const urls: string[] = []
  globalThis.fetch = async (input) => {
    urls.push(String(input))
    return Response.json({ code: 200, data: '译文' })
  }

  const cases: [endpoint: string, expected: string][] = [
    ['https://case14.example/path-token', 'https://case14.example/path-token/translate'],
    ['https://case14.example/', 'https://case14.example/translate'],
    ['https://case14.example/nested/translate', 'https://case14.example/nested/translate'],
  ]
  for (const [endpoint, expected] of cases) {
    urls.length = 0
    const provider = new DeepLXProvider({ apiKey: '', endpoint })
    await provider.translate({
      texts: ['Hello'],
      sourceLanguage: 'auto',
      targetLanguage: 'zh-Hans',
    })
    assert.equal(urls[0], expected, `端点 ${endpoint} 归一化异常`)
  }
}

// 15. 公共网关（api.deeplx.org）档位：请求间隔更保守（跨两次调用仍生效）
{
  const startTimes: number[] = []
  globalThis.fetch = async () => {
    startTimes.push(Date.now())
    return Response.json({ code: 200, data: '译文' })
  }

  const provider = new DeepLXProvider({
    apiKey: '',
    endpoint: 'https://api.deeplx.org/placeholder-token/translate',
  })
  await provider.translate({
    texts: ['one'],
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
  })
  await provider.translate({
    texts: ['two'],
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
  })

  assert.equal(startTimes.length, 2)
  const gap = startTimes[1] - startTimes[0]
  assert.ok(
    gap >= TEST_PUBLIC_MIN_INTERVAL - 20,
    `公共网关请求间隔应不小于 ${TEST_PUBLIC_MIN_INTERVAL}ms，实际 ${gap}ms`,
  )
}

// 16. 公共网关持续 429：只重试 1 次（总请求 2 个），避免重试烧配额
{
  let callCount = 0
  globalThis.fetch = async () => {
    callCount += 1
    return Response.json({ code: 429, message: 'Too many requests' }, { status: 429 })
  }

  const provider = new DeepLXProvider({
    apiKey: '',
    endpoint: 'https://api.deeplx.org/placeholder-token/translate',
  })
  await assert.rejects(
    () =>
      provider.translate({
        texts: ['Hello World'],
        sourceLanguage: 'auto',
        targetLanguage: 'zh-Hans',
      }),
    (error: unknown) => isTranslationRateLimitError(error),
  )
  assert.equal(callCount, 2)
}

console.log('deeplx-provider: ok')
