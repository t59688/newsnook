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
configureDeepLxThrottleForTests({
  minIntervalMs: TEST_MIN_INTERVAL,
  backoffBaseMs: TEST_BACKOFF_BASE,
  backoffMaxMs: 400,
  jitterMaxMs: 0,
  maxRetries: 3,
})

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

// 7. 共享节流门：即使并发 >1，请求开始时刻也按最小间隔错开
{
  const startTimes: number[] = []
  globalThis.fetch = async (_input, init) => {
    startTimes.push(Date.now())
    const body = JSON.parse(String(init?.body)) as { text: string }
    return Response.json({ code: 200, data: `LX:${body.text}` })
  }

  const provider = new DeepLXProvider({
    apiKey: '',
    endpoint: 'https://case7.example/translate',
    concurrency: 4,
  })
  const results = await provider.translate({
    texts: ['a', 'b', 'c', 'd'],
    sourceLanguage: 'en',
    targetLanguage: 'zh-Hans',
  })

  assert.deepEqual(results, ['LX:a', 'LX:b', 'LX:c', 'LX:d'])
  const sorted = [...startTimes].sort((x, y) => x - y)
  for (let i = 1; i < sorted.length; i += 1) {
    const gap = sorted[i] - sorted[i - 1]
    assert.ok(gap >= TEST_MIN_INTERVAL - 20, `请求开始间隔过小：${gap}ms`)
  }
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

console.log('deeplx-provider: ok')
