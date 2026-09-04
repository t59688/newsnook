import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'

import { normalizeTranslationPrefs } from '../src/features/translation/config'
import { DeepLXProvider, GoogleProvider } from '../src/features/translation/providers'
import { TranslationService } from '../src/features/translation/service'
import type { TranslationProvider } from '../src/features/translation/types'

const window = parseHTML('<html><body></body></html>')
Object.assign(globalThis, {
  DOMParser: window.DOMParser,
  NodeFilter: { SHOW_TEXT: 4 },
  document: window.document,
})

const provider: TranslationProvider = {
  id: 'mlkit',
  async translate(request) {
    return request.texts.map((text) => `译:${text}`)
  },
}

const service = new TranslationService(provider)
const translated = await service.translateArticle(
  'A useful title',
  '<p>Hello <strong>world</strong>.</p><pre><span>const hello = 1</span></pre><img src="cover.jpg" alt="Cover">',
  { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'replace' },
)

assert.equal(translated.title, '译:A useful title')
assert.match(translated.html, /译:Hello/)
assert.match(translated.html, /<strong[^>]*>译:world<\/strong>/)
assert.match(translated.html, /const hello = 1/)
assert.doesNotMatch(translated.html, /译:const hello/)
assert.match(translated.html, /src="cover.jpg"/)

const compared = await service.translateArticle(
  'A useful title',
  '<p>Hello <strong>world</strong>.</p><blockquote><p>Quoted text</p></blockquote><pre><span>const hello = 1</span></pre>',
  { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'compare' },
)
assert.equal(compared.title, '译:A useful title')
assert.match(compared.html, /Hello <strong>world<\/strong>\./)
assert.match(compared.html, /class="reader-translation"/)
assert.match(compared.html, /译:Hello world\./)
assert.match(compared.html, /译:Quoted text/)
assert.doesNotMatch(compared.html, /译:const hello/)

const normalized = normalizeTranslationPrefs({
  provider: 'unknown',
  sourceLanguage: 'en',
  targetLanguage: 'en',
  cloud: { google: { apiKey: 'local-key', endpoint: 'https://example.com' } },
})
assert.equal(normalized.provider, 'mlkit')
assert.equal(normalized.displayMode, 'replace')
assert.notEqual(normalized.sourceLanguage, normalized.targetLanguage)
assert.equal(normalized.cloud.google.apiKey, 'local-key')

const normalizedAuto = normalizeTranslationPrefs({})
assert.equal(normalizedAuto.sourceLanguage, 'auto')
assert.equal(normalizedAuto.targetLanguage, 'zh-Hans')

const autoKeepsTarget = normalizeTranslationPrefs({
  sourceLanguage: 'auto',
  targetLanguage: 'zh-Hans',
})
assert.equal(autoKeepsTarget.sourceLanguage, 'auto')
assert.equal(autoKeepsTarget.targetLanguage, 'zh-Hans')

const invalidSource = normalizeTranslationPrefs({ sourceLanguage: 'xx' })
assert.equal(invalidSource.sourceLanguage, 'auto')

const mlkitAuto = await service.translateArticle(
  'A useful title',
  '<p>Hello <strong>world</strong> and more english sentences for detection.</p>',
  { sourceLanguage: 'auto', targetLanguage: 'zh-Hans', displayMode: 'replace' },
)
assert.equal(mlkitAuto.usedFallback, false)
assert.equal(mlkitAuto.resolvedSourceLanguage, 'en')
assert.equal(mlkitAuto.title, '译:A useful title')

const mlkitFallback = await service.translateArticle(
  'Hi',
  '<p>ok</p>',
  { sourceLanguage: 'auto', targetLanguage: 'zh-Hans', displayMode: 'replace' },
)
assert.equal(mlkitFallback.usedFallback, true)
assert.equal(mlkitFallback.resolvedSourceLanguage, 'en')

const identityProvider: TranslationProvider = {
  id: 'mlkit',
  async translate(request) {
    return request.texts
  },
}
const identityService = new TranslationService(identityProvider)
const tradToSimp = await identityService.translateArticle(
  '今日國際新聞',
  '<p>關注世界經濟與科技發展，多家媒體報導了相關進展。</p>',
  { sourceLanguage: 'auto', targetLanguage: 'zh-Hans', displayMode: 'replace' },
)
assert.equal(tradToSimp.resolvedSourceLanguage, 'zh-Hant')
assert.equal(tradToSimp.title, '今日国际新闻')
assert.match(tradToSimp.html, /关注世界经济与科技发展/)
assert.match(tradToSimp.html, /媒体/)
assert.doesNotMatch(tradToSimp.html, /國際|關注|經濟/)

const originalFetch = globalThis.fetch
const requests: { url: string; body: unknown; authorization: string | null }[] = []
globalThis.fetch = async (input, init) => {
  const headers = new Headers(init?.headers)
  const body = JSON.parse(String(init?.body)) as { text?: string | string[] }
  requests.push({
    url: String(input),
    body,
    authorization: headers.get('Authorization'),
  })
  const text = typeof body.text === 'string' ? body.text : body.text?.[0] ?? ''
  return Response.json({ code: 200, data: `LX:${text}` })
}

const deepLx = new DeepLXProvider({
  apiKey: '',
  endpoint: 'https://deeplx.example/path-token/translate',
})
const deepLxResult = await deepLx.translate({
  texts: ['Hello', 'World'],
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.deepEqual(deepLxResult, ['LX:Hello', 'LX:World'])
assert.equal(requests.length, 2)
assert.equal(requests[0].url, 'https://deeplx.example/path-token/translate')
assert.equal(requests[0].authorization, null)
assert.deepEqual(requests[0].body, {
  text: 'Hello',
  source_lang: 'EN',
  target_lang: 'ZH',
})

globalThis.fetch = originalFetch

// Test streaming onPartial progressive updates
const streamingPartials: string[] = []
const progressiveProvider: TranslationProvider = {
  id: 'deeplx',
  async translate(request) {
    const results: string[] = []
    for (let i = 0; i < request.texts.length; i++) {
      const translated = `流:${request.texts[i]}`
      results.push(translated)
      request.onBatch?.([translated], i)
    }
    return results
  },
}

const progressiveService = new TranslationService(progressiveProvider)
await progressiveService.translateArticle(
  'Stream Title',
  '<p>First paragraph.</p><p>Second paragraph.</p>',
  { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'compare' },
  {
    onPartial: (partial) => {
      streamingPartials.push(partial.html)
    },
  },
)

assert.ok(streamingPartials.length >= 2) // 中间 batch 会被节流合并，首末必达
assert.match(streamingPartials[0], /First paragraph\./)
assert.doesNotMatch(streamingPartials[0], /流:Second paragraph\./)
assert.match(
  streamingPartials[streamingPartials.length - 1],
  /流:Second paragraph\./,
)

// 长文部分失败时，异常抛出前必须强制 flush 最新成功段，不能被 120ms 节流吞掉。
const retainedPartials: { title: string; html: string }[] = []
const partialFailureProvider: TranslationProvider = {
  id: 'openai',
  async translate(request) {
    request.onBatch?.(['译:Partial Title'], 0)
    request.onBatch?.(['译:First paragraph.'], 1)
    request.onBatch?.(['译:Third paragraph.'], 3)
    throw new Error('one paragraph failed')
  },
}
const partialFailureService = new TranslationService(partialFailureProvider)
await assert.rejects(
  () =>
    partialFailureService.translateArticle(
      'Partial Title',
      '<p>First paragraph.</p><p>Second paragraph.</p><p>Third paragraph.</p>',
      { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'replace' },
      {
        onPartial: (partial) => retainedPartials.push(partial),
      },
    ),
  /one paragraph failed/,
)
const retainedLatest = retainedPartials[retainedPartials.length - 1]
assert.ok(retainedLatest)
assert.equal(retainedLatest.title, '译:Partial Title')
assert.match(retainedLatest.html, /译:First paragraph\./)
assert.match(retainedLatest.html, />Second paragraph\.</)
assert.match(retainedLatest.html, /译:Third paragraph\./)

// Test Google batching limits (10 items per batch)
const batchSizes: number[] = []
globalThis.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body)) as { q?: string[] }
  if (body.q) batchSizes.push(body.q.length)
  return Response.json({
    data: {
      translations: (body.q ?? []).map((t) => ({ translatedText: `G:${t}` })),
    },
  })
}

const google = new GoogleProvider({ apiKey: 'key', endpoint: 'https://translation.googleapis.com' })
const twentyFiveTexts = Array.from({ length: 25 }, (_, i) => `Paragraph ${i + 1}`)
const googleResults = await google.translate({
  texts: twentyFiveTexts,
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.equal(googleResults.length, 25)
assert.deepEqual(batchSizes, [10, 10, 5]) // 10 paragraphs per batch rolling!

// Google auto: omit source field
let googleAutoBody: Record<string, unknown> | null = null
globalThis.fetch = async (_input, init) => {
  googleAutoBody = JSON.parse(String(init?.body)) as Record<string, unknown>
  return Response.json({
    data: { translations: [{ translatedText: 'G:auto' }] },
  })
}
await google.translate({
  texts: ['Hello world for auto detect'],
  sourceLanguage: 'auto',
  targetLanguage: 'zh-Hans',
})
assert.ok(googleAutoBody)
assert.equal('source' in googleAutoBody, false)
assert.equal(googleAutoBody.target, 'zh-CN')

// Test DeepLX concurrency limit (max 3 concurrent requests)
let activeConcurrent = 0
let maxConcurrentObserved = 0
globalThis.fetch = async (_input, init) => {
  activeConcurrent++
  if (activeConcurrent > maxConcurrentObserved) {
    maxConcurrentObserved = activeConcurrent
  }
  const body = JSON.parse(String(init?.body)) as { text?: string }
  await new Promise((r) => setTimeout(r, 10))
  activeConcurrent--
  return Response.json({ code: 200, data: `LX:${body.text}` })
}

const deepLxConcurrency = new DeepLXProvider({ apiKey: '', endpoint: 'https://deeplx.example/translate' })
await deepLxConcurrency.translate({
  texts: twentyFiveTexts,
  sourceLanguage: 'en',
  targetLanguage: 'zh-Hans',
})
assert.ok(maxConcurrentObserved <= 3, `Max concurrent requests was ${maxConcurrentObserved}, expected <= 3`)

globalThis.fetch = originalFetch

const kindsLog: (
  | import('../src/features/translation/types').TranslationTextKind[]
  | undefined
)[] = []
const kindProbe: TranslationProvider = {
  id: 'mlkit',
  async translate(request) {
    kindsLog.push(request.textKinds)
    return request.texts.map((text) => `译:${text}`)
  },
}
const kindService = new TranslationService(kindProbe)
await kindService.translateArticle(
  'Title One',
  '<p>Body A</p><p>Body B</p>',
  { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'replace' },
)
{
  const last = kindsLog[kindsLog.length - 1]
  assert.equal(last, undefined)
}

kindsLog.length = 0
await kindService.translateArticle(
  'Title Two',
  '<p>Only body</p>',
  { sourceLanguage: 'en', targetLanguage: 'zh-Hans', displayMode: 'compare' },
)
{
  const last = kindsLog[kindsLog.length - 1]
  assert.equal(last, undefined)
}

console.log('translation-service: ok')


