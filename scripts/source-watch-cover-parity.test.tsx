import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, beforeEach, test } from 'node:test'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
  }
}

const { window } = parseHTML('<!doctype html><html><body><div id="root"></div></body></html>')
const storage = new MemoryStorage()
window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(cb, 0) as unknown as number
window.cancelAnimationFrame = (id: number) => clearTimeout(id)
window.requestIdleCallback = (cb: IdleRequestCallback) => {
  cb({ didTimeout: false, timeRemaining: () => 50 })
  return 0
}
window.cancelIdleCallback = () => {}

Object.assign(globalThis, {
  window,
  document: window.document,
  localStorage: storage,
  Event: window.Event,
  Node: window.Node,
  Element: window.Element,
  HTMLElement: window.HTMLElement,
  Image: window.Image,
  requestAnimationFrame: window.requestAnimationFrame,
  cancelAnimationFrame: window.cancelAnimationFrame,
  requestIdleCallback: window.requestIdleCallback,
  cancelIdleCallback: window.cancelIdleCallback,
  matchMedia: () => ({
    matches: false,
    media: '',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
  React,
  IS_REACT_ACT_ENVIRONMENT: true,
})

const realFetch = globalThis.fetch

const { createRoot } = await import('react-dom/client')
const { ArticleRow } = await import('../src/components/ArticleItem')
const { WatchArticleFeed } = await import('../src/features/sourceWatch/WatchArticleFeed')
const { saveCachedBody } = await import('../src/lib/bodyCache')
const { saveCachedArticles } = await import('../src/lib/storage')
const {
  hydrateWatchEventsFromCache,
  loadWatchState,
  reconcileWatchArticles,
  saveWatchState,
  watchArticleKey,
} = await import('../src/features/sourceWatch/store')
type Article = import('../src/lib/types').Article

const container = document.getElementById('root')!
const root = createRoot(container)

function makeArticle(id: string, overrides: Partial<Article> = {}): Article {
  return {
    id,
    title: `测试文章 ${id}`,
    summary: `测试摘要 ${id}`,
    publishedAt: 1_800_000_000_000,
    hasRealDate: true,
    sourceId: 'kr36',
    sourceName: '36氪',
    sourceLabel: '36氪',
    sourceGroup: 'cn',
    originUrl: `https://www.36kr.com/p/${id}`,
    contentType: 'article',
    ...overrides,
  }
}

async function flushAsync(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i += 1) {
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 10))
    })
  }
}

beforeEach(async () => {
  storage.clear()
  globalThis.fetch = realFetch
  await act(async () => {
    root.render(null)
  })
})

after(async () => {
  globalThis.fetch = realFetch
  await act(async () => {
    root.render(null)
  })
})

test('ArticleRow (row): keeps clean text-only homepage items while protecting failed or fallback covers with EditorialCoverPlaceholder', async () => {
  globalThis.fetch = async () => {
    throw new Error('offline')
  }

  const textOnly = makeArticle('text-only-row', { image: undefined })
  await act(async () => {
    root.render(
      <ArticleRow article={textOnly} read={false} saved={false} onOpen={() => {}} variant="row" />,
    )
  })
  assert.equal(container.querySelector('.editorial-article-cover'), null, '首页纯文本条目默认不应强加封面占位')

  await act(async () => {
    root.render(
      <ArticleRow
        article={textOnly}
        read={false}
        saved={false}
        onOpen={() => {}}
        variant="row"
        fallbackCover
      />,
    )
  })
  const fallbackSlot = container.querySelector('.editorial-article-cover')
  assert.ok(fallbackSlot, '启用 fallbackCover 的无图行应保留 4:3 封面槽位')
  assert.ok(fallbackSlot.querySelector('svg'), '启用 fallbackCover 的无图行应展示编辑占位封面 SVG')
  const placeholderRoot = fallbackSlot.querySelector('.editorial-cover-root')
  assert.ok(placeholderRoot, '应渲染 EditorialCoverPlaceholder')
  assert.equal(placeholderRoot.classList.contains('absolute'), true, '显式传入 absolute 时占位封面必须保持 absolute 定位')
  assert.equal(
    placeholderRoot.classList.contains('relative'),
    false,
    '绝对定位占位封面不得同时保留 relative，否则 Tailwind v4 中 .relative 会覆盖 .absolute 并把后续 InkImage 挤出 overflow-hidden',
  )

  const brokenImage = makeArticle('broken-image-row', { image: 'https://img.36krcdn.com/broken.jpg' })
  await act(async () => {
    root.render(
      <ArticleRow article={brokenImage} read={false} saved={false} onOpen={() => {}} variant="row" />,
    )
  })

  const dispatchImageError = async () => {
    const img = container.querySelector('img')
    assert.ok(img, '预期存在尝试加载的封面 img')
    await act(async () => {
      img.dispatchEvent(new window.Event('error'))
    })
  }

  await dispatchImageError()
  await dispatchImageError()
  await flushAsync()

  assert.equal(container.querySelector('img'), null, '图片彻底失败后 InkImage 应卸载 img')
  const protectedSlot = container.querySelector('.editorial-article-cover')
  assert.ok(protectedSlot, '原本存在封面的 row 在图片失效后不能塌陷掉右侧封面槽')
  assert.ok(protectedSlot.querySelector('svg'), '原本存在封面的 row 在图片失效后应回退到 EditorialCoverPlaceholder')
})

test('WatchArticleFeed (classic): aligns container rhythm, retains row covers on error/missing, and persists recovered og:image', async () => {
  globalThis.fetch = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('missing-cover-item')) {
      return new Response(
        '<html><head><meta property="og:image" content="https://cdn.example.com/recovered-og.jpg"></head><body><p>正文</p></body></html>',
        { status: 200, headers: { 'Content-Type': 'text/html' } },
      )
    }
    throw new Error('unexpected network failure')
  }

  const lead = makeArticle('lead-item', { image: 'https://img.36krcdn.com/lead.jpg' })
  const imagedRow = makeArticle('imaged-row', { image: 'https://img.36krcdn.com/row.jpg' })
  const missingRow = makeArticle('missing-cover-item', { image: undefined })
  const events = [lead, imagedRow, missingRow].map((article, idx) => ({
    key: watchArticleKey(article),
    sourceId: article.sourceId,
    article,
    discoveredAt: 1_800_000_000_000 - idx * 1000,
    read: false,
  }))

  saveWatchState({
    rules: [{ sourceId: 'kr36', mode: 'inbox', enabled: true }],
    events,
    cursors: {},
    lastChecked: {},
    intervalMinutes: 60,
    quietHours: true,
    wifiOnly: false,
  })

  await act(async () => {
    root.render(
      <WatchArticleFeed
        events={events}
        layout="classic"
        readIds={new Set()}
        savedIds={new Set()}
        onOpen={() => {}}
      />,
    )
  })
  await flushAsync()

  const feedBody = container.querySelector('.sw-feed-body')
  assert.ok(feedBody, 'WatchArticleFeed 应包含 .sw-feed-body')
  assert.ok(feedBody.className.includes('max-w-[2400px]'), '容器宽度应与 FeedScreen 对齐')
  assert.ok(feedBody.className.includes('pb-12'), '底部留白应与 FeedScreen 对齐')

  const rowItems = container.querySelectorAll('li.editorial-article-item')
  assert.equal(rowItems.length, 2, '头条之外其余 2 篇应按经典单列行渲染')
  for (const row of rowItems) {
    assert.ok(row.querySelector('.editorial-article-cover'), '关注收件箱每一行都必须拥有 4:3 封面槽位')
  }

  const recoveredImg = rowItems[1]?.querySelector('img')
  assert.ok(recoveredImg, '无图条目应通过 og:image 按需补全封面 img')
  assert.equal(recoveredImg.getAttribute('src'), 'https://cdn.example.com/recovered-og.jpg')

  const persisted = loadWatchState().events.find(event => event.article.id === 'missing-cover-item')
  assert.equal(
    persisted?.article.image,
    'https://cdn.example.com/recovered-og.jpg',
    '按需补救得到的封面应写回本地 watch store，后续不再丢图',
  )
})

test('hydrateWatchEventsFromCache and reconcileWatchArticles recover stubs from cache and preserve covers across RSS refreshes', () => {
  const nativeStub = makeArticle('kr36:https://www.36kr.com/p/406421', {
    title: '原生后台标题',
    summary: '',
    image: undefined,
    hasRealDate: false,
    originUrl: 'https://www.36kr.com/p/406421',
  })
  const stubKey = watchArticleKey(nativeStub)
  nativeStub.id = stubKey

  const bodyOnlyArticle = makeArticle('qbit-body-only', {
    sourceId: 'qbitai',
    sourceName: '量子位',
    originUrl: 'https://www.qbitai.com/2026/11/body-only.html',
    summary: '量子位摘要',
    image: undefined,
  })

  saveWatchState({
    rules: [
      { sourceId: 'kr36', mode: 'inbox', enabled: true },
      { sourceId: 'qbitai', mode: 'inbox', enabled: true },
    ],
    events: [
      { key: stubKey, sourceId: 'kr36', article: nativeStub, discoveredAt: 1_800_000_000_000, read: false },
      { key: watchArticleKey(bodyOnlyArticle), sourceId: 'qbitai', article: bodyOnlyArticle, discoveredAt: 1_799_999_990_000, read: true },
    ],
    cursors: { kr36: [stubKey], qbitai: [watchArticleKey(bodyOnlyArticle)] },
    lastChecked: {},
    intervalMinutes: 60,
    quietHours: true,
    wifiOnly: false,
  })

  saveCachedArticles('kr36', [
    makeArticle('kr36-406421', {
      title: '完整首页标题',
      summary: '来自首页缓存的摘要',
      image: 'https://img.36krcdn.com/from-home-cache.jpg',
      originUrl: 'https://www.36kr.com/p/406421',
      hasRealDate: true,
      publishedAt: 1_799_999_500_000,
    }),
  ])

  saveCachedBody(bodyOnlyArticle, {
    html: '<p>正文首图</p><img src="https://cdn.qbitai.com/inside-body.jpg">',
    bodySource: 'origin',
  })

  assert.equal(hydrateWatchEventsFromCache(), true, '应从首页缓存与正文缓存补全关注条目')

  const afterHydrate = loadWatchState()
  const hydratedKr = afterHydrate.events[0]
  assert.equal(hydratedKr.article.id, 'kr36-406421')
  assert.equal(hydratedKr.article.hasRealDate, true)
  assert.equal(hydratedKr.article.summary, '来自首页缓存的摘要')
  assert.equal(hydratedKr.article.image, 'https://img.36krcdn.com/from-home-cache.jpg')
  assert.equal(hydratedKr.read, false)

  const hydratedQbit = afterHydrate.events[1]
  assert.equal(hydratedQbit.article.image, 'https://cdn.qbitai.com/inside-body.jpg')
  assert.equal(hydratedQbit.read, true, '缓存补全不能篡改已有已读状态')

  const refreshWithoutImage = makeArticle('qbit-body-only', {
    sourceId: 'qbitai',
    sourceName: '量子位',
    originUrl: 'https://www.qbitai.com/2026/11/body-only.html',
    summary: '量子位摘要',
    image: undefined,
  })
  const { next } = reconcileWatchArticles(afterHydrate, 'qbitai', [refreshWithoutImage], 1_800_000_100_000)
  assert.equal(
    next.events[1]?.article.image,
    'https://cdn.qbitai.com/inside-body.jpg',
    '后续无图 RSS 刷新不能抹掉已恢复的封面图',
  )
})

test('source-watch.css: .sw-feed-bleed does not darken paper-faint metadata compared to FeedScreen', () => {
  const css = readFileSync(new URL('../src/styles/source-watch.css', import.meta.url), 'utf8')
  const match = css.match(/\.sw-feed-bleed\s*\{[^}]*\}/)
  assert.ok(match, '必须存在 .sw-feed-bleed 样式块')
  assert.doesNotMatch(
    match[0],
    /--color-paper-faint\s*:/,
    '.sw-feed-bleed 不应覆盖 --color-paper-faint，以确保元信息灰度层级与首页完全一致',
  )
})
