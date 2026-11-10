import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseHTML } from 'linkedom'

const source = readFileSync(resolve('src/screens/MeScreen.tsx'), 'utf8')
const styles = readFileSync(resolve('src/styles/settings-paper.css'), 'utf8')

// Node 中编译期变量由 Vite 注入，这里只为服务端渲染提供测试值。
;(globalThis as typeof globalThis & { __APP_VERSION__: string; React: typeof React }).__APP_VERSION__ = 'test'
;(globalThis as typeof globalThis & { React: typeof React }).React = React
const { MeScreen } = await import('../src/screens/MeScreen')

const noop = () => {}
const html = renderToStaticMarkup(createElement(MeScreen, {
  later: [],
  historyCount: 17,
  readCount: 21,
  customSourcesSummary: '1 个自建订阅 · OPML 导入导出',
  categoriesSummary: '6 个启用分类',
  presetsSummary: '科技数码',
  typographySummary: '黑体 · 字号标准',
  appearanceSummary: '墨问 · 昼读',
  translationSummary: 'DeepLX',
  readAloudSummary: '系统语音',
  aiSummary: '服务商与功能模型',
  proxySummary: '直连',
  storageSummary: '预存与缓存',
  accountSummary: '未登录',
  onOpenLater: noop,
  onOpenHistory: noop,
  onOpenLocalSearch: noop,
  onOpenCustomSources: noop,
  onOpenFeedStore: noop,
  onOpenCategories: noop,
  onOpenPresets: noop,
  onOpenSourceWatch: noop,
  onOpenTypographySettings: noop,
  onOpenAppearanceSettings: noop,
  onOpenTranslationSettings: noop,
  onOpenWikiSettings: noop,
  onOpenReadAloudSettings: noop,
  onOpenAiSettings: noop,
  onOpenProxySettings: noop,
  onOpenStorageSettings: noop,
  onOpenAccountSync: noop,
  onOpenAbout: noop,
}))
const { document } = parseHTML(html)
const root = document.querySelector('.paper-settings-root')
assert.ok(root, '实际设置页必须使用隔离样式根')
assert.equal(document.querySelectorAll('.paper-settings-group').length, 4)
assert.equal(document.querySelectorAll('button').length, 18, '保留全部十八个真实业务入口')
assert.equal(document.querySelectorAll('.paper-settings-item').length, 16)
for (const label of ['稍后读', '最近阅读', '本地搜索', 'RSS 订阅商店', '自定义订阅与 OPML', '分类与自动刷新', '场景预设', '关注动态', '阅读字体', '外观', '翻译', '划词百科', '朗读', 'AI', '网络与代理', '离线存储与备份', '账户与同步', '关于有所闻']) {
  assert.ok([...document.querySelectorAll('button')].some((button) => button.textContent?.includes(label)),
    `入口不可丢失：${label}`)
}
assert.match(html, /最近阅读.*17 篇/)
assert.match(html, /已读 21 篇/)
assert.match(html, /1 个自建订阅/)
for (const key of ['me-reading', 'me-feed-store', 'me-custom-sources', 'me-presets', 'me-translation', 'me-about']) {
  assert.ok(document.querySelector(`[data-tour="${key}"]`), `新手引导锚点丢失：${key}`)
}

const handlers = [
  'onOpenLater', 'onOpenHistory', 'onOpenLocalSearch', 'onOpenFeedStore',
  'onOpenCustomSources', 'onOpenCategories', 'onOpenPresets', 'onOpenSourceWatch',
  'onOpenTypographySettings', 'onOpenAppearanceSettings',
  'onOpenTranslationSettings', 'onOpenWikiSettings', 'onOpenReadAloudSettings', 'onOpenAiSettings',
  'onOpenProxySettings', 'onOpenStorageSettings', 'onOpenAccountSync', 'onOpenAbout',
]
for (const handler of handlers) {
  assert.match(source, new RegExp('onClick=\\{' + handler + '\\}'), `入口必须连接真实回调：${handler}`)
}
assert.match(styles, /\.paper-settings-item \+ \.paper-settings-item::before/)
assert.match(styles, /inset:\s*0 12px auto 52px/)
assert.match(styles, /html\[data-theme='light'\]\[data-scheme='ink'\] \.paper-settings-root/)
assert.match(styles, /html\[data-theme='dark'\]\[data-scheme='ink'\] \.paper-settings-root/)
assert.doesNotMatch(styles, /\.paper-settings-shell\s+button\s*\{[^}]*min-height\s*:/s)

assert.doesNotMatch(styles, /color-mix\(/, '避免旧版 WebView 构建错误转换含变量的 color-mix')
assert.match(styles, /\.paper-settings-shortcut-icon\s*\{[^}]*background:\s*var\(--paper-accent-soft\)/s)
console.log('settings paper UI: 18 routes, 4 groups, real counts, theme isolation and switch guards OK')
