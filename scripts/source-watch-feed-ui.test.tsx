import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import type { Article } from '../src/lib/types'
import type { WatchEvent } from '../src/features/sourceWatch/store'
import { DEFAULT_TRANSLATION_PREFS } from '../src/features/translation/config'

Object.assign(globalThis, { React })

const now = Date.now()
const sample = (id: string, title: string, image?: string): WatchEvent => {
  const article: Article = {
    id,
    sourceId: 'openai-news',
    sourceName: 'OpenAI News',
    sourceLabel: 'OpenAI',
    sourceGroup: 'ai',
    title,
    summary: '为开发者提供新的研究与产品资讯，包含技术细节和相关参考。',
    publishedAt: now - 4 * 3600000,
    hasRealDate: true,
    originUrl: 'https://openai.com/news/' + id,
    image,
  }
  return {
    key: 'openai-news:https://openai.com/news/' + id,
    sourceId: article.sourceId,
    article,
    discoveredAt: now,
    read: id === 'read',
  }
}
const events = [
  sample('lead', 'OpenAI 发布新版开发者工具', 'https://openai.com/research/cover.jpg'),
  sample('read', '新的安全性研究与技术进展'),
  sample('latest', '中英文标题与摘要展示保持一致'),
]

test('watch inbox shares the actual home feed article and lead components', async () => {
  const { WatchArticleFeed } = await import('../src/features/sourceWatch/WatchArticleFeed')
  const html = renderToStaticMarkup(React.createElement(WatchArticleFeed, {
    events,
    layout: 'classic',
    readIds: new Set(),
    savedIds: new Set(['read']),
    translationPrefs: { ...DEFAULT_TRANSLATION_PREFS, translateFeed: false },
    onOpen: () => {},
  }))
  assert.match(html, /editorial-feed-list/)
  assert.match(html, /editorial-lead-mobile/)
  assert.match(html, /editorial-feed-day-group/)
  assert.match(html, /editorial-feed-rows/)
  assert.match(html, /editorial-article-item/)
  assert.match(html, /editorial-article-row/)
  assert.match(html, /data-read="true"/)
  assert.match(html, /data-read="false"/)
  assert.match(html, /新的安全性研究与技术进展/)
  assert.match(html, /OpenAI 发布新版开发者工具/)
  assert.doesNotMatch(html, /sw-story/)
})

test('watch inbox inherits the homepage two-column card mode', async () => {
  const { WatchArticleFeed } = await import('../src/features/sourceWatch/WatchArticleFeed')
  const html = renderToStaticMarkup(React.createElement(WatchArticleFeed, {
    events: events.slice(1),
    layout: 'cards',
    readIds: new Set(),
    savedIds: new Set(),
    translationPrefs: { ...DEFAULT_TRANSLATION_PREFS, translateFeed: false },
    onOpen: () => {},
  }))
  assert.match(html, /editorial-mobile-card-grid/)
  assert.match(html, /data-variant="compact-card"/)
  assert.match(html, /editorial-article-item/)
  assert.match(html, /data-read="true"/)
  assert.doesNotMatch(html, /sw-story/)
})

test('inbox renders at most 40 articles before loading more, retaining unread controls', async () => {
  const total = 61
  const manyEvents = Array.from({ length: total }, (_, index) => sample('article-' + index, '近期值得关注的更新 ' + index))
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => key === 'newsnook:source-watch:v1' ? JSON.stringify({
      rules: [{ sourceId: 'openai-news', mode: 'instant', enabled: true }],
      events: manyEvents,
      cursors: {}, lastChecked: {}, intervalMinutes: 60,
      quietHours: false, wifiOnly: false,
    }) : null,
  } })
  try {
    const { SourceWatchScreen } = await import('../src/screens/settings/SourceWatchScreen')
    const markup = renderToStaticMarkup(React.createElement(SourceWatchScreen, {
      sources: [{ id: 'openai-news', name: 'OpenAI News', label: 'OpenAI', group: 'ai', kind: 'feed', url: 'https://openai.com/news/rss.xml', enabled: true }],
      translationPrefs: { ...DEFAULT_TRANSLATION_PREFS, translateFeed: false },
      onBack: () => {}, onOpenArticle: () => {},
    }))
    assert.equal((markup.match(/class="editorial-article-item /g) || []).length, 40)
    assert.match(markup, /剩余 21 篇/)
    assert.match(markup, /全部已读/)
    assert.match(markup, /仅未读/)
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('lead story keeps the shared editorial cover visible when an image cannot load', async () => {
  const { LeadStory } = await import('../src/components/ArticleItem')
  const html = renderToStaticMarkup(React.createElement(LeadStory, {
    article: events[0].article,
    read: false,
    saved: false,
    prestored: false,
    onOpen: () => {},
    revealed: true,
    variant: 'lead',
  }))
  assert.match(html, /editorial-lead-mobile-photo/)
  assert.match(html, /editorial-cover-root/)
  assert.match(html, /editorial-scene-svg/)
  assert.match(html, /editorial-lead-mobile-title/)
  const withoutCover = renderToStaticMarkup(React.createElement(LeadStory, {
    article: { ...events[0].article, image: undefined },
    read: false,
    saved: false,
    onOpen: () => {},
    revealed: true,
    variant: 'lead',
  }))
  assert.match(withoutCover, /editorial-cover-root/)
})
