import assert from 'node:assert/strict'
import { normalizeTranslationPrefs } from '../src/features/translation/config'
import {
  assertOpenAiConfig,
  cleanOpenAiTranslation,
  extractOpenAiChatContent,
  normalizeOpenAiBaseUrl,
  OPENAI_TRANSLATION_STOP,
} from '../src/features/translation/openai'
import {
  isHunyuanTranslationModel,
  openAiTranslationSystemPrompt,
  openAiTranslationUserPrompt,
} from '../src/features/translation/prompts'
import { OpenAiProvider } from '../src/features/translation/providers'

const empty = normalizeTranslationPrefs({})
assert.equal(empty.cloud.openai?.endpoint, 'https://api.openai.com/v1')
assert.equal(empty.cloud.openai?.apiKey, '')
assert.equal(empty.cloud.openai?.model ?? '', '')
assert.equal(empty.cloud.openai.concurrency, 2)

const saved = normalizeTranslationPrefs({
  provider: 'openai',
  cloud: {
    openai: {
      apiKey: 'sk-test',
      endpoint: 'https://gateway.example/v1/',
      model: 'gpt-4o-mini',
    },
  },
})
assert.equal(saved.provider, 'openai')
assert.equal(saved.cloud.openai.apiKey, '')
assert.equal(saved.ai.providers[0].apiKey, 'sk-test')
assert.equal(saved.cloud.openai.endpoint, 'https://gateway.example/v1/')
assert.equal(saved.cloud.openai.model, 'gpt-4o-mini')

const withConcurrency = normalizeTranslationPrefs({
  cloud: {
    openai: {
      apiKey: 'k',
      endpoint: 'https://api.openai.com/v1',
      model: 'm',
      concurrency: 5,
    },
  },
})
assert.equal(withConcurrency.cloud.openai.concurrency, 5)

const clampedHigh = normalizeTranslationPrefs({
  cloud: { openai: { apiKey: '', endpoint: 'https://api.openai.com/v1', concurrency: 99 } },
})
assert.equal(clampedHigh.cloud.openai.concurrency, 2)

const clampedLow = normalizeTranslationPrefs({
  cloud: { openai: { apiKey: '', endpoint: 'https://api.openai.com/v1', concurrency: 0 } },
})
assert.equal(clampedLow.cloud.openai.concurrency, 2)

const clampedFloat = normalizeTranslationPrefs({
  cloud: { openai: { apiKey: '', endpoint: 'https://api.openai.com/v1', concurrency: 3.7 } },
})
assert.equal(clampedFloat.cloud.openai.concurrency, 2)

assert.equal(normalizeOpenAiBaseUrl('https://api.openai.com/v1/'), 'https://api.openai.com/v1')
assert.equal(
  normalizeOpenAiBaseUrl('https://api.openai.com/v1/chat/completions'),
  'https://api.openai.com/v1',
)
assert.equal(
  normalizeOpenAiBaseUrl('https://gateway.example/v1/chat/completions/'),
  'https://gateway.example/v1',
)

assert.equal(cleanOpenAiTranslation('  你好世界  '), '你好世界')
assert.equal(cleanOpenAiTranslation('"你好世界"'), '你好世界')
assert.equal(cleanOpenAiTranslation('```\n你好世界\n```'), '你好世界')
assert.equal(cleanOpenAiTranslation('「你好」'), '「你好」')
assert.equal(cleanOpenAiTranslation('“你好”'), '你好')
assert.equal(cleanOpenAiTranslation('<source_text>关于</source_text>'), '关于')
assert.equal(cleanOpenAiTranslation('<translation>关于</translation>'), '关于')
assert.equal(cleanOpenAiTranslation('Translation: 关于'), '关于')
assert.equal(cleanOpenAiTranslation('译文：关于'), '关于')
assert.equal(cleanOpenAiTranslation('翻译结果：关于我们'), '关于我们')
assert.equal(
  cleanOpenAiTranslation('最终以69票的优势获胜。</center>'),
  '最终以69票的优势获胜。',
)
assert.equal(
  cleanOpenAiTranslation(
    '最终赢得 279 票。</target_text>< | hy_end__of__translation | >',
  ),
  '最终赢得 279 票。',
)
assert.equal(
  cleanOpenAiTranslation(
    '在美国，癌症手术的等待时间正日益延长。</target_text><｜hy_end▁of▁sentence｜>',
  ),
  '在美国，癌症手术的等待时间正日益延长。',
)
assert.equal(
  cleanOpenAiTranslation(
    '美国癌症手术的等待时间正越来越长。</target_text>< | hy_end__of__sentence | >',
  ),
  '美国癌症手术的等待时间正越来越长。',
)
assert.equal(
  cleanOpenAiTranslation('<target_text>关于我们</target_text>'),
  '关于我们',
)

assert.equal(
  extractOpenAiChatContent(
    JSON.stringify({ choices: [{ message: { content: '手机端字符串体' } }] }),
  ),
  '手机端字符串体',
)
assert.equal(
  extractOpenAiChatContent({
    choices: [{ message: { content: [{ type: 'text', text: '分段' }, { type: 'text', text: '内容' }] } }],
  }),
  '分段内容',
)
assert.equal(extractOpenAiChatContent('not-json'), null)

assert.throws(
  () => assertOpenAiConfig({ apiKey: '', endpoint: 'https://api.openai.com/v1', model: 'x' }),
  /API Key/,
)
assert.throws(
  () => assertOpenAiConfig({ apiKey: 'k', endpoint: 'https://api.openai.com/v1', model: '' }),
  /Model/,
)
assert.throws(
  () => assertOpenAiConfig({ apiKey: 'k', endpoint: 'http://insecure.example/v1', model: 'x' }),
  /HTTPS/,
)

const systemAuto = openAiTranslationSystemPrompt('auto', 'zh-Hans', 'paragraph')
assert.match(systemAuto, /translate any source text provided by the user into Simplified Chinese/)
assert.match(systemAuto, /senior professional translation expert/)
assert.match(systemAuto, /Context & Domain Adaptation/)
assert.match(systemAuto, /Tone & Style Fidelity/)
assert.match(systemAuto, /Native Idiomaticity/)
assert.match(systemAuto, /Neutral & Objective Stance/)
assert.match(systemAuto, /Output the translation directly without any explanations/)
assert.match(systemAuto, /Do not wrap the translation in XML or HTML tags/)
assert.doesNotMatch(systemAuto, /信、达、雅|信达雅/)
assert.doesNotMatch(systemAuto, /from English/i)
assert.doesNotMatch(systemAuto, /Tehran|德黑兰|真主党|信达雅/)

const systemEn = openAiTranslationSystemPrompt('auto', 'en', 'paragraph')
assert.match(systemEn, /into English/)
assert.doesNotMatch(systemEn, /Simplified Chinese/)

const systemHeadline = openAiTranslationSystemPrompt('en', 'zh-Hans', 'headline')
assert.equal(systemHeadline, openAiTranslationSystemPrompt('en', 'zh-Hans', 'paragraph'))

const userHeadline = openAiTranslationUserPrompt('Hello world', 'zh-Hans', 'headline')
assert.match(userHeadline, /^原文：\nHello world$/)
assert.doesNotMatch(userHeadline, /source_text/)
assert.equal(userHeadline, openAiTranslationUserPrompt('Hello world', 'zh-Hans', 'paragraph'))

const userBody = openAiTranslationUserPrompt('Hello world', 'zh-Hans', 'paragraph')
assert.match(userBody, /原文：/)
assert.doesNotMatch(userBody, /信达雅|literal|source_text/i)

assert.equal(isHunyuanTranslationModel('hy-mt1.5-7b'), true)
assert.equal(isHunyuanTranslationModel('Hunyuan-MT-7B'), true)
assert.equal(isHunyuanTranslationModel('gpt-4o-mini'), false)
assert.equal(openAiTranslationSystemPrompt('en', 'zh-Hans', 'paragraph', 'hy-mt1.5'), '')
assert.match(
  openAiTranslationUserPrompt('Hello world', 'zh-Hans', 'paragraph', 'hunyuan-mt-7b'),
  /^将以下文本翻译为中文，注意只需要输出翻译后的结果，不要额外解释：\n\nHello world$/,
)

const originalFetch = globalThis.fetch
const requests: { url: string; body: Record<string, unknown>; authorization: string | null }[] = []

globalThis.fetch = async (input, init) => {
  const headers = new Headers(init?.headers)
  const body = JSON.parse(String(init?.body)) as Record<string, unknown>
  requests.push({
    url: String(input),
    body,
    authorization: headers.get('Authorization'),
  })
  const messages = body.messages as { role: string; content: string }[]
  const user = messages.find((m) => m.role === 'user')?.content ?? ''
  const xml = user.match(/<source_text>\n([\s\S]*?)\n<\/source_text>/)
  const hunyuan = user.match(/不要额外解释：\n\n([\s\S]+)$/)
  const plain = user.match(/^原文：\n([\s\S]+)$/)
  const english = user.match(/without additional explanation\.\n\n([\s\S]+)$/)
  const text = xml?.[1] ?? hunyuan?.[1] ?? english?.[1] ?? plain?.[1] ?? user
  return Response.json({
    choices: [{ message: { content: `AI:${text}` } }],
  })
}

const provider = new OpenAiProvider({
  apiKey: 'sk-test',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
})

const batchIndexes: number[] = []
const result = await provider.translate({
  texts: ['Hello', 'World'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
  onBatch: (_batch, startIndex) => {
    batchIndexes.push(startIndex)
  },
})

assert.deepEqual(result, ['AI:Hello', 'AI:World'])
assert.equal(requests.length, 2)
assert.equal(requests[0].url, 'https://api.openai.com/v1/chat/completions')
assert.equal(requests[0].authorization, 'Bearer sk-test')
assert.equal(requests[0].body.model, 'gpt-4o-mini')
assert.equal(requests[0].body.stream, false)
assert.equal(requests[0].body.temperature, 0.6)
assert.ok(Array.isArray(requests[0].body.messages))
assert.deepEqual(
  batchIndexes.sort((a, b) => a - b),
  [0, 1],
)

requests.length = 0
const mixed = await provider.translate({
  texts: ['Market rallies on rate cut hopes', 'Investors bought shares after the announcement.'],
  textKinds: ['headline', 'paragraph'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.deepEqual(mixed, [
  'AI:Market rallies on rate cut hopes',
  'AI:Investors bought shares after the announcement.',
])
assert.equal(requests.length, 2)
const sys0 = (requests[0].body.messages as { role: string; content: string }[]).find(
  (m) => m.role === 'system',
)?.content
const sys1 = (requests[1].body.messages as { role: string; content: string }[]).find(
  (m) => m.role === 'system',
)?.content
assert.match(String(sys0), /senior professional translation expert/)
assert.match(String(sys0), /Output the translation directly/)
assert.equal(sys0, sys1)
assert.doesNotMatch(String(sys1), /信、达、雅|信达雅/)
assert.equal(requests[0].body.temperature, 0.6)
assert.deepEqual(requests[0].body.stop, OPENAI_TRANSLATION_STOP)

requests.length = 0
const hunyuanProvider = new OpenAiProvider({
  apiKey: 'sk-test',
  endpoint: 'https://api.openai.com/v1',
  model: 'hy-mt1.5-7b',
})
const hunyuanResult = await hunyuanProvider.translate({
  texts: ['Hello'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.deepEqual(hunyuanResult, ['AI:Hello'])
const hunyuanMessages = requests[0].body.messages as { role: string; content: string }[]
assert.equal(
  hunyuanMessages.some((m) => m.role === 'system'),
  false,
)
assert.match(hunyuanMessages[0]?.content ?? '', /将以下文本翻译为中文/)
assert.deepEqual(requests[0].body.stop, OPENAI_TRANSLATION_STOP)

await assert.rejects(
  () =>
    provider.translate({
      texts: ['a', 'b'],
      textKinds: ['headline'],
      sourceLanguage: 'en',
      targetLanguage: 'zh-Hans',
    }),
  /textKinds/,
)

await assert.rejects(
  () =>
    new OpenAiProvider({
      apiKey: 'sk',
      endpoint: 'https://api.openai.com/v1',
      model: '',
    }).translate({ texts: ['x'], sourceLanguage: 'en', targetLanguage: 'zh-Hans' }),
  /Model/,
)

let retryableCalls = 0
globalThis.fetch = async () => {
  retryableCalls += 1
  return Response.json({ error: { message: 'quota exceeded' } }, { status: 429 })
}
await assert.rejects(
  () =>
    provider.translate({ texts: ['x'], sourceLanguage: 'en', targetLanguage: 'zh-Hans' }),
  /AI 翻译：quota exceeded/,
)
assert.equal(retryableCalls, 2, '429 should retry the failed segment once')

let nonRetryableCalls = 0
globalThis.fetch = async () => {
  nonRetryableCalls += 1
  return Response.json({ error: { message: 'invalid api key' } }, { status: 401 })
}
await assert.rejects(
  () =>
    provider.translate({ texts: ['x'], sourceLanguage: 'en', targetLanguage: 'zh-Hans' }),
  /AI 翻译：invalid api key/,
)
assert.equal(nonRetryableCalls, 1, 'non-retryable 4xx should fail immediately')

let active = 0
let maxActive = 0
const many = Array.from({ length: 10 }, (_, i) => `P${i}`)
globalThis.fetch = async (_input, init) => {
  active++
  maxActive = Math.max(maxActive, active)
  const body = JSON.parse(String(init?.body)) as {
    messages: { role: string; content: string }[]
  }
  await new Promise((r) => setTimeout(r, 15))
  active--
  const user = body.messages.find((m) => m.role === 'user')?.content ?? ''
  return Response.json({ choices: [{ message: { content: user } }] })
}

const providerDefault = new OpenAiProvider({
  apiKey: 'sk-test',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
})
await providerDefault.translate({ texts: many, sourceLanguage: 'en', targetLanguage: 'zh-Hans' })
assert.ok(maxActive <= 2, `default max concurrent ${maxActive}`)

active = 0
maxActive = 0
const providerFive = new OpenAiProvider({
  apiKey: 'sk-test',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  concurrency: 5,
})
await providerFive.translate({ texts: many, sourceLanguage: 'en', targetLanguage: 'zh-Hans' })
assert.ok(maxActive <= 5, `custom max concurrent ${maxActive}`)
assert.ok(maxActive >= 2, `expected some parallelism, got ${maxActive}`)

// 单段最终失败时不能 fail-fast：其它 worker 继续完成，成功段仍逐条 onBatch。
const bestEffortCalls = new Map<string, number>()
const bestEffortCompleted: number[] = []
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as {
    messages: { role: string; content: string }[]
  }
  const user = body.messages.find((message) => message.role === 'user')?.content ?? ''
  const plain = user.match(/^原文：\n([\s\S]+)$/)
  const text = plain?.[1] ?? user
  bestEffortCalls.set(text, (bestEffortCalls.get(text) ?? 0) + 1)
  if (text === 'Fail') {
    return Response.json({ error: { message: 'bad paragraph' } }, { status: 400 })
  }
  await new Promise((resolve) => setTimeout(resolve, 5))
  return Response.json({ choices: [{ message: { content: `AI:${text}` } }] })
}
await assert.rejects(
  () =>
    providerFive.translate({
      texts: ['One', 'Fail', 'Three'],
      sourceLanguage: 'en',
      targetLanguage: 'zh-Hans',
      onBatch: (_batch, startIndex) => bestEffortCompleted.push(startIndex),
    }),
  /已完成 2\/3 段，1 段失败；已完成内容已保留/,
)
assert.deepEqual(
  bestEffortCompleted.sort((a, b) => a - b),
  [0, 2],
)
assert.equal(bestEffortCalls.get('Fail'), 1)
assert.equal(bestEffortCalls.get('One'), 1)
assert.equal(bestEffortCalls.get('Three'), 1)

// 同一 Provider 实例重试时只补失败段：已成功段直接复用，不再重发整篇。
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as {
    messages: { role: string; content: string }[]
  }
  const user = body.messages.find((message) => message.role === 'user')?.content ?? ''
  const plain = user.match(/^原文：\n([\s\S]+)$/)
  const text = plain?.[1] ?? user
  bestEffortCalls.set(text, (bestEffortCalls.get(text) ?? 0) + 1)
  await new Promise((resolve) => setTimeout(resolve, 5))
  return Response.json({ choices: [{ message: { content: `AI:${text}` } }] })
}
const resumedIndexes: number[] = []
const resumed = await providerFive.translate({
  texts: ['One', 'Fail', 'Three'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
  onBatch: (_batch, startIndex) => resumedIndexes.push(startIndex),
})
assert.deepEqual(resumed, ['AI:One', 'AI:Fail', 'AI:Three'])
assert.deepEqual(
  resumedIndexes.sort((a, b) => a - b),
  [0, 1, 2],
  'resumed run must still report every segment through onBatch',
)
assert.equal(bestEffortCalls.get('Fail'), 2, 'only the failed segment is re-requested')
assert.equal(bestEffortCalls.get('One'), 1, 'completed segments are reused on retry')
assert.equal(bestEffortCalls.get('Three'), 1, 'completed segments are reused on retry')

// 语向不同不能复用：同一文本换目标语言必须重新请求
await providerFive.translate({ texts: ['One'], sourceLanguage: 'en', targetLanguage: 'ja' })
assert.equal(bestEffortCalls.get('One'), 2, 'different target language must not hit the cache')

// 新实例不共享缓存：设置页「测试 AI 翻译」每次都真实发请求
const freshProvider = new OpenAiProvider({
  apiKey: 'sk-test',
  endpoint: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  concurrency: 5,
})
await freshProvider.translate({ texts: ['Three'], sourceLanguage: 'en', targetLanguage: 'zh-Hans' })
assert.equal(bestEffortCalls.get('Three'), 2, 'a new provider instance starts with an empty cache')

// 同一次调用内重复文本只请求一次，结果按原顺序展开，onBatch 仍逐条回调
let dedupCalls = 0
globalThis.fetch = async (_input, init) => {
  dedupCalls++
  const body = JSON.parse(String(init?.body)) as {
    messages: { role: string; content: string }[]
  }
  const user = body.messages.find((m) => m.role === 'user')?.content ?? ''
  const plain = user.match(/^原文：\n([\s\S]+)$/)
  await new Promise((r) => setTimeout(r, 5))
  return Response.json({ choices: [{ message: { content: `AI:${plain?.[1] ?? user}` } }] })
}
const dedupIndexes: number[] = []
const dedupResult = await providerFive.translate({
  texts: ['Same caption', 'Body text', 'Same caption'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
  onBatch: (_batch, startIndex) => {
    dedupIndexes.push(startIndex)
  },
})
assert.deepEqual(dedupResult, ['AI:Same caption', 'AI:Body text', 'AI:Same caption'])
assert.equal(dedupCalls, 2)
assert.deepEqual(
  dedupIndexes.sort((a, b) => a - b),
  [0, 1, 2],
)

// 文本相同但场景不同（headline vs paragraph）不去重，仍各自请求
dedupCalls = 0
const kindSplit = await providerFive.translate({
  texts: ['Same words', 'Same words'],
  textKinds: ['headline', 'paragraph'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.deepEqual(kindSplit, ['AI:Same words', 'AI:Same words'])
assert.equal(dedupCalls, 2)

globalThis.fetch = originalFetch

console.log('openai-provider: ok')
