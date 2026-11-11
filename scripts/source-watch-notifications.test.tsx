import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { alertableWatchEvents, announceWatchEvents, subscribeWatchAnnouncements, muteWatchBannersForNotificationOpen } from '../src/features/sourceWatch/announcements'
import { groupWatchNotificationEvents } from '../src/features/sourceWatch/notificationBatch'
import { getWatchUnreadCount } from '../src/features/sourceWatch/useWatchUnreadCount'
import { loadWatchState, markWatchArticleRead, saveWatchState, type WatchEvent, type WatchState } from '../src/features/sourceWatch/store'
import type { Article } from '../src/lib/types'

// The current repository's Node tests use tsx's classic JSX compiler.
Object.assign(globalThis, { React })

const article: Article = {
  id: 'article1', title: 'OpenAI launches an update', summary: '',
  publishedAt: 1700000000000, hasRealDate: true,
  sourceId: 'openai-news', sourceName: 'OpenAI News', sourceLabel: 'OpenAI',
  sourceGroup: 'ai', originUrl: 'https://openai.com/news/one',
}
const event: WatchEvent = { key: 'openai-news:https://openai.com/news/one', sourceId: 'openai-news', article, read: false, discoveredAt: Date.now() }
const state: WatchState = {
  rules: [{ sourceId: 'openai-news', mode: 'instant', enabled: true }],
  events: [event], cursors: {}, lastChecked: {}, intervalMinutes: 60, quietHours: false, wifiOnly: false,
}

test('instant updates announce exactly once to current listeners, not after unsubscribe', () => {
  let captured = 0
  const unsubscribe = subscribeWatchAnnouncements(events => { captured += events.length })
  announceWatchEvents([event])
  assert.equal(captured, 1)
  unsubscribe()
  announceWatchEvents([event])
  assert.equal(captured, 1)
})

test('inbox-only and quiet-hour events never show in-app banners', () => {
  const atNoon = new Date('2026-11-10T12:00:00')
  const atMidnight = new Date('2026-11-10T23:59:00')
  assert.equal(alertableWatchEvents([event], state, atNoon).length, 1)
  assert.equal(alertableWatchEvents([event], { ...state, quietHours: true }, atMidnight).length, 0)
  assert.equal(alertableWatchEvents([event], { ...state, rules: [{ sourceId: 'openai-news', mode: 'inbox', enabled: true }] }, atNoon).length, 0)
  assert.equal(alertableWatchEvents([event], { ...state, rules: [] }, atNoon).length, 0)
})

test('reading a watch article clears the persistent global unread count once', () => {
  const entries = new Map<string, string>()
  let changed = 0
  const prevStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const prevWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem(key: string) { return entries.get(key) || null },
    setItem(key: string, value: string) { entries.set(key, value) },
  } })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { dispatchEvent() { changed++ } } })
  try {
    saveWatchState(state)
    assert.equal(getWatchUnreadCount(), 1)
    assert.equal(markWatchArticleRead({ ...article, originUrl: article.originUrl + '/#focus' }), true)
    assert.equal(getWatchUnreadCount(), 0)
    assert.equal(markWatchArticleRead(article), false)
    assert.equal(changed, 2)
    assert.equal(loadWatchState().events[0].read, true)
  } finally {
    if (prevStorage) Object.defineProperty(globalThis, 'localStorage', prevStorage)
    else Reflect.deleteProperty(globalThis, 'localStorage')
    if (prevWindow) Object.defineProperty(globalThis, 'window', prevWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  }
})

test('the feed toolbar bell is accessible and displays a bounded unread count', async () => {
  const { WatchInboxButton } = await import('../src/features/sourceWatch/WatchInboxButton')
  const html = renderToStaticMarkup(React.createElement(WatchInboxButton, { unreadCount: 3, onOpen: () => {} }))
  assert.match(html, /aria-label="关注动态，3 篇未读"/)
  assert.match(html, />3<\/span>/)
  assert.match(renderToStaticMarkup(React.createElement(WatchInboxButton, { unreadCount: 0, onOpen: () => {} })), /aria-label="关注动态"/)
  assert.match(renderToStaticMarkup(React.createElement(WatchInboxButton, { unreadCount: 120, onOpen: () => {} })), />99\+<\/span>/)
})

test('real foreground updates are grouped into one native notification per opted-in source', () => {
  const earlier = { ...event, key: 'openai-news:https://openai.com/news/older',
    article: { ...article, title: 'Earlier update', originUrl: 'https://openai.com/news/older' },
  }
  const latest = { ...event, article: { ...article, title: 'Newest update' } }
  const other = { ...event, sourceId: 'other-news', key: 'other-news:https://example.com/news/3',
    article: { ...article, sourceId: 'other-news', sourceName: 'Other News', originUrl: 'https://example.com/news/3' },
  }
  const subscribed = { ...state, rules: [...state.rules, { sourceId: 'other-news', mode: 'instant' as const, enabled: true }] }
  const grouped = groupWatchNotificationEvents([latest, earlier, other], subscribed, new Date('2026-11-10T12:00:00'))
  assert.equal(grouped.length, 2)
  assert.deepEqual(grouped.find(item => item.id === 'openai-news')?.articles.map(a => a.title), ['Earlier update', 'Newest update'])
  assert.equal(grouped.find(item => item.id === 'other-news')?.articles.length, 1)
  assert.equal(groupWatchNotificationEvents([latest], { ...state, rules: [{ sourceId: 'openai-news', mode: 'inbox', enabled: true }] }).length, 0)
  assert.equal(groupWatchNotificationEvents([latest], { ...state, quietHours: true }, new Date('2026-11-10T23:00:00')).length, 0)
  assert.equal(groupWatchNotificationEvents([{ ...latest, read: true }], state).length, 0)
})

test('opening an Android notification prevents a duplicate in-app banner on article entry', () => {
  const originalNow = Date.now
  let announcements = 0
  const unsubscribe = subscribeWatchAnnouncements(() => { announcements++ })
  try {
    Date.now = () => 1_000
    muteWatchBannersForNotificationOpen()
    announceWatchEvents([event])
    assert.equal(announcements, 0)
    Date.now = () => 10_000
    announceWatchEvents([event])
    assert.equal(announcements, 1)
  } finally {
    Date.now = originalNow
    unsubscribe()
  }
})
