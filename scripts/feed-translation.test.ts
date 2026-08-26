import assert from 'node:assert/strict'

import {
  saveCachedFeedTranslation,
  loadCachedFeedTranslation,
  clearFeedTranslations,
} from '../src/features/translation/feedTranslationStorage'
import { detectLanguage } from '../src/features/translation/detectLanguage'
import { DEFAULT_TRANSLATION_PREFS, normalizeTranslationPrefs } from '../src/features/translation/config'
import { isArticleForeign, isValidTranslationQuality } from '../src/features/translation/quality'
import { collectFeedTranslationWork } from '../src/features/translation/useFeedTranslation'
import type { TranslatedFeedItem } from '../src/features/translation/types'
import type { Article } from '../src/lib/types'

// 1. Mock LocalStorage for node environment
const memoryStore = new Map<string, string>()
;(globalThis as any).localStorage = {
  getItem: (k: string) => memoryStore.get(k) ?? null,
  setItem: (k: string, v: string) => memoryStore.set(k, String(v)),
  removeItem: (k: string) => memoryStore.delete(k),
  clear: () => memoryStore.clear(),
  get length() {
    return memoryStore.size
  },
  key: (index: number) => Array.from(memoryStore.keys())[index] ?? null,
}

// 2. Test Prefs default & normalization
assert.equal(DEFAULT_TRANSLATION_PREFS.translateFeed, true)
const normalized = normalizeTranslationPrefs({ translateFeed: false })
assert.equal(normalized.translateFeed, false)

// 3. Test Storage & Cache
clearFeedTranslations()
assert.equal(loadCachedFeedTranslation('art-1', 'zh-Hans'), null)

saveCachedFeedTranslation({
  articleId: 'art-1',
  title: '苹果发布新款 M4 MacBook Pro',
  snippet: '新款笔记本搭载 M4 芯片，性能迎来重大提升。',
  targetLanguage: 'zh-Hans',
  translatedAt: Date.now(),
})

const cached = loadCachedFeedTranslation('art-1', 'zh-Hans')
assert.ok(cached)
assert.equal(cached?.title, '苹果发布新款 M4 MacBook Pro')
assert.equal(cached?.snippet, '新款笔记本搭载 M4 芯片，性能迎来重大提升。')

// Test different target language returns null if not translated
assert.equal(loadCachedFeedTranslation('art-1', 'en'), null)

clearFeedTranslations()
memoryStore.set(
  'newsnook:feed-trans:zh-Hans:art-dirty',
  JSON.stringify({
    articleId: 'art-dirty',
    title: '等待时间正越来越长。</target_text><｜hy_end▁of▁sentence｜>',
    targetLanguage: 'zh-Hans',
    translatedAt: Date.now(),
  }),
)
const stripped = loadCachedFeedTranslation('art-dirty', 'zh-Hans')
assert.equal(stripped?.title, '等待时间正越来越长。')

// 4. Test language detection for feed item titles
const enTitle = detectLanguage('Apple unveils new M4 MacBook Pro with unprecedented AI performance')
assert.equal(enTitle.language, 'en')

const zhTitle = detectLanguage('中国空间站顺利完成最新一次太空出舱任务')
assert.equal(zhTitle.language, 'zh-Hans')

const jaTitle = detectLanguage('ソニー、新型イメージセンサーを発表 スマートフォン向けに最適化')
assert.equal(jaTitle.language, 'ja')

// 5. Test isArticleForeign (including mixed English title + Chinese summary boilerplate)
assert.equal(
  isArticleForeign(
    {
      title: "Wang Gungwu on the lessons of Chinese history and the Cold War",
      summary: "南华早报 · 2026",
    },
    'zh-Hans',
  ),
  true,
)

assert.equal(
  isArticleForeign(
    {
      title: "Apple unveils new chips",
      summary: "Tech news summary",
    },
    'zh-Hans',
  ),
  true,
)

assert.equal(
  isArticleForeign(
    {
      title: "中国空间站最新动态",
      summary: "神舟飞船乘组顺利开展各项实验",
    },
    'zh-Hans',
  ),
  false,
)

// 短中文标题 + 空摘要：样本不足触发检测回退，不应被误判为外文（否则已是目标语言仍请求）
assert.equal(isArticleForeign({ title: '中美经贸会谈落幕', summary: '' }, 'zh-Hans'), false)

// 短外文标题仍应命中翻译队列
assert.equal(isArticleForeign({ title: 'Fed cuts rates', summary: '' }, 'zh-Hans'), true)

// 6. Test isValidTranslationQuality (Rejecting partial / corrupted translations)
// Bad case 1: "Wang Gungwu on the lessons of Chinese history and the Cold War" -> "王 gunshot on Chinese history and the Cold War"
assert.equal(
  isValidTranslationQuality(
    "Wang Gungwu on the lessons of Chinese history and the Cold War",
    "王 gunshot on Chinese history and the Cold War",
    "zh-Hans",
  ),
  false,
)

// Bad case 2: Unchanged foreign text returned
assert.equal(
  isValidTranslationQuality(
    "Beyond call centres? Philippines reopens Manila for outsourcing edge",
    "Beyond call centres? Philippines reopens Manila for outsourcing edge",
    "zh-Hans",
  ),
  false,
)

// Good case 1: Faithful full translation
assert.equal(
  isValidTranslationQuality(
    "Wang Gungwu on the lessons of Chinese history and the Cold War",
    "王赓武谈中国历史与冷战的教训",
    "zh-Hans",
  ),
  true,
)

// Good case 2: Proper translation with brand name preserved
assert.equal(
  isValidTranslationQuality(
    "DeepSeek V3 released with high performance",
    "DeepSeek V3 正式发布，性能表现优异",
    "zh-Hans",
  ),
  true,
)

// 7. collectFeedTranslationWork：已在状态 / 已持久缓存 / 会话失败 / 非外文的条目都不再进入待翻译队列
const makeArticle = (id: string, title: string): Article => ({
  id,
  title,
  summary: '',
  publishedAt: Date.now(),
  hasRealDate: true,
  sourceId: 'src-test',
  sourceName: 'Test',
  sourceLabel: 'Test',
  sourceGroup: 'intl',
  originUrl: `https://example.com/${id}`,
})

clearFeedTranslations()
saveCachedFeedTranslation({
  articleId: 'art-cached',
  title: '已缓存的中文译文标题',
  targetLanguage: 'zh-Hans',
  translatedAt: Date.now(),
})

const stateMap = new Map<string, TranslatedFeedItem>([
  [
    'art-in-state',
    { articleId: 'art-in-state', title: '已在状态里的译文', targetLanguage: 'zh-Hans', translatedAt: Date.now() },
  ],
  [
    'art-stale-lang',
    { articleId: 'art-stale-lang', title: '旧语言译文', targetLanguage: 'en', translatedAt: Date.now() },
  ],
])

const work = collectFeedTranslationWork(
  [
    makeArticle('art-cached', 'Cached headline should reuse persistent cache'),
    makeArticle('art-fresh', 'Fresh headline still needs a translation request'),
    makeArticle('art-failed', 'Failed headline must be skipped this session'),
    makeArticle('art-zh', '中文标题不进入翻译队列'),
    makeArticle('art-in-state', 'Already translated headline in state'),
    makeArticle('art-stale-lang', 'State entry holds wrong target language'),
  ],
  stateMap,
  new Set(['art-failed']),
  'zh-Hans',
)

// 命中持久缓存的直接复用，不再发请求
assert.deepEqual(
  work.cachedHits.map((item) => item.articleId),
  ['art-cached'],
)
// 只有真正没有译文的外文标题才需要联网（状态里语言不匹配的也要重翻）
assert.deepEqual(
  work.needed.map((item) => item.id),
  ['art-fresh', 'art-stale-lang'],
)

console.log('feed-translation: ok')
