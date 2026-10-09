import assert from 'node:assert/strict'

import { DeepLXProvider } from '../src/features/translation/providers'

// 1. 测试 /translate 接口的 429 自动退避重试
let callCount = 0
globalThis.fetch = async () => {
  callCount++
  if (callCount === 1) {
    // 第一次调用返回 429
    return Response.json({ code: 429, message: 'Too Many Requests' }, { status: 200 })
  }
  // 第二次重试成功
  return Response.json({ code: 200, data: '测试译文' }, { status: 200 })
}

const provider = new DeepLXProvider({
  apiKey: '',
  endpoint: 'https://deeplx.example.com/translate',
  concurrency: 1,
})

const results = await provider.translate({
  texts: ['Hello World'],
  sourceLanguage: 'auto',
  targetLanguage: 'zh-Hans',
})

assert.equal(results[0], '测试译文')
assert.equal(callCount, 2)

// 2. 测试 /v2/translate 官方兼容模式批量打包
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body))
  assert.ok(Array.isArray(body.text))
  assert.equal(body.text.length, 2)
  return Response.json({
    code: 200,
    translations: body.text.map((t: string) => ({ text: `译:${t}` })),
  })
}

const v2Provider = new DeepLXProvider({
  apiKey: '',
  endpoint: 'https://deeplx.example.com/v2/translate',
})

const v2Results = await v2Provider.translate({
  texts: ['Item 1', 'Item 2'],
  sourceLanguage: 'auto',
  targetLanguage: 'zh-Hans',
})

assert.deepEqual(v2Results, ['译:Item 1', '译:Item 2'])

// 3. 单段接口模式下，同一次调用内重复文本只请求一次，结果按原顺序展开
let singleCalls = 0
globalThis.fetch = async (_input, init) => {
  singleCalls++
  const body = JSON.parse(String(init?.body)) as { text?: string }
  return Response.json({ code: 200, data: `LX:${body.text}` })
}

const dedupProvider = new DeepLXProvider({
  apiKey: '',
  endpoint: 'https://deeplx.example.com/translate',
  concurrency: 2,
})
const dedupResults = await dedupProvider.translate({
  texts: ['Repeat me', 'Something else', 'Repeat me'],
  sourceLanguage: 'auto',
  targetLanguage: 'zh-Hans',
})
assert.deepEqual(dedupResults, ['LX:Repeat me', 'LX:Something else', 'LX:Repeat me'])
assert.equal(singleCalls, 2)

console.log('deeplx-provider: ok')
