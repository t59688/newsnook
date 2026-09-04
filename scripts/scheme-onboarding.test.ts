/**
 * 风格选择引导：只出现一次、候选项不含自定义、首页空闲才展示。
 * 运行：npm run test:scheme-onboarding
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { parseHTML } from 'linkedom'

import {
  previewThemeScheme,
  schemeOnboardingOptions,
  shouldShowSchemeOnboarding,
} from '../src/lib/schemeOnboarding'

const idle = {
  seen: false,
  tab: 'today',
  reading: false,
  settingsOpen: false,
  sourceFocused: false,
  eggOpen: false,
  deepLinkError: false,
} as const

assert.equal(shouldShowSchemeOnboarding(idle), true, '未看过且首页空闲时应展示')
assert.equal(
  shouldShowSchemeOnboarding({ ...idle, seen: true }),
  false,
  '看过或跳过后不再展示',
)
assert.equal(shouldShowSchemeOnboarding({ ...idle, tab: 'me' }), false, '不在速闻页不展示')
assert.equal(shouldShowSchemeOnboarding({ ...idle, reading: true }), false, '阅读器打开时不展示')
assert.equal(
  shouldShowSchemeOnboarding({ ...idle, settingsOpen: true }),
  false,
  '设置栈打开时不展示',
)
assert.equal(
  shouldShowSchemeOnboarding({ ...idle, sourceFocused: true }),
  false,
  '信源聚焦时不展示',
)
assert.equal(shouldShowSchemeOnboarding({ ...idle, eggOpen: true }), false, '彩蛋打开时不展示')
assert.equal(
  shouldShowSchemeOnboarding({ ...idle, deepLinkError: true }),
  false,
  '深链报错时不展示',
)

const options = schemeOnboardingOptions()
assert.deepEqual(
  options.map((item) => item.id),
  ['ink', 'celadon', 'pearl'],
  '引导只列出内置风格，不含自定义',
)
assert.ok(options.every((item) => item.label && item.caption), '每项都有中文名称与说明')

console.log('scheme-onboarding visibility: ok')

const { document: previewDocument } = parseHTML(
  '<html data-theme="light" data-scheme="ink"><head><meta name="theme-color" content="#000"></head></html>',
)
Object.defineProperty(globalThis, 'document', {
  value: previewDocument,
  configurable: true,
})

previewThemeScheme('pearl')
assert.equal(document.documentElement.dataset.scheme, 'pearl')
assert.equal(
  document.documentElement.classList.contains('theme-switching'),
  false,
  '预览不得给全站加 transition',
)
previewThemeScheme('celadon')
assert.equal(document.documentElement.dataset.scheme, 'celadon')
assert.equal(document.documentElement.classList.contains('theme-switching'), false)

console.log('scheme-onboarding preview: ok')

// 同步预览能即时的前提：引导期间 <main> 被搁起、遮罩不透明，整页改 data-scheme 只重画弹层和壳
const css = readFileSync(resolve('src/index.css'), 'utf8')
const parkedStart = css.indexOf('.content-parked {')
assert.ok(parkedStart >= 0, 'index.css 缺少 .content-parked')
assert.match(
  css.slice(parkedStart, css.indexOf('\n}', parkedStart)),
  /content-visibility:\s*hidden/,
  '.content-parked 应用 content-visibility: hidden 让下层列表退出样式重算与绘制',
)

const appSource = readFileSync(resolve('src/App.tsx'), 'utf8')
assert.match(
  appSource,
  /showSchemeOnboarding \? ' content-parked' : ''/,
  '风格引导打开时 App 必须给 <main> 挂 content-parked',
)

const promptSource = readFileSync(resolve('src/components/SchemeOnboardingPrompt.tsx'), 'utf8')
assert.ok(
  /fixed inset-0 z-\[65\][^"]*\bbg-ink\b/.test(promptSource),
  '引导遮罩应为不透明 bg-ink：既盖住搁起的列表，也让整屏底色跟着预览变',
)
assert.ok(!promptSource.includes('bg-black/50'), '引导遮罩不再是半透明压暗层')
assert.ok(
  !promptSource.includes('schedulePreviewThemeScheme'),
  '点选预览走同步 previewThemeScheme，不再延后到下一帧',
)

console.log('scheme-onboarding isolation: ok')

const memory = new Map<string, string>()
;(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => void memory.set(key, String(value)),
  removeItem: (key: string) => void memory.delete(key),
  key: (index: number) => [...memory.keys()][index] ?? null,
  get length() {
    return memory.size
  },
}

const { hasSeenSchemeOnboarding, markSchemeOnboardingSeen } = await import('../src/lib/storage')

assert.equal(hasSeenSchemeOnboarding(), false, '升级前没有标记，视为未看过')
markSchemeOnboardingSeen()
assert.equal(hasSeenSchemeOnboarding(), true, '确认或稍后再说都算看过')
assert.equal(
  memory.get('newsnook:scheme-onboarding-seen'),
  'true',
  '落在 newsnook: 前缀键上',
)

console.log('scheme-onboarding seen flag: ok')
console.log('\nALL SCHEME ONBOARDING CHECKS PASSED')
