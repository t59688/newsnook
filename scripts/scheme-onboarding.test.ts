/**
 * 风格选择引导：只出现一次、候选项不含自定义、首页空闲才展示。
 * 运行：npm run test:scheme-onboarding
 */
import assert from 'node:assert/strict'

import { parseHTML } from 'linkedom'

import {
  cancelScheduledPreview,
  previewThemeScheme,
  schedulePreviewThemeScheme,
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

// 模拟浏览器帧循环：rAF 回调排队，flushFrame 走完一帧；两帧后才允许整页改写
const frameQueue = new Map<number, () => void>()
let frameSeq = 0
;(globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame = (cb: () => void) => {
  frameQueue.set(++frameSeq, cb)
  return frameSeq
}
;(globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame = (id: number) => {
  frameQueue.delete(id)
}
const flushFrame = () => {
  const callbacks = [...frameQueue.values()]
  frameQueue.clear()
  for (const cb of callbacks) cb()
}

previewThemeScheme('ink')
schedulePreviewThemeScheme('pearl')
assert.equal(document.documentElement.dataset.scheme, 'ink', '点击当帧不改整页方案，先让选中态上屏')
flushFrame()
assert.equal(document.documentElement.dataset.scheme, 'ink', '本帧绘制前触发的 rAF 仍不写入')
flushFrame()
assert.equal(document.documentElement.dataset.scheme, 'pearl', '下一帧才落到 html[data-scheme]')
assert.equal(document.documentElement.classList.contains('theme-switching'), false)

schedulePreviewThemeScheme('celadon')
schedulePreviewThemeScheme('pearl')
schedulePreviewThemeScheme('ink')
flushFrame()
flushFrame()
assert.equal(document.documentElement.dataset.scheme, 'ink', '连点多张卡只保留最后一张')
assert.equal(frameQueue.size, 0, '被顶掉的预览不再占用帧回调')

schedulePreviewThemeScheme('celadon')
cancelScheduledPreview()
flushFrame()
flushFrame()
assert.equal(document.documentElement.dataset.scheme, 'ink', '关闭/确认前取消后，迟到的预览不再写入')

schedulePreviewThemeScheme('celadon')
flushFrame()
cancelScheduledPreview()
flushFrame()
assert.equal(document.documentElement.dataset.scheme, 'ink', '第二拍排队后取消同样有效')

schedulePreviewThemeScheme('pearl')
previewThemeScheme('celadon')
flushFrame()
flushFrame()
assert.equal(
  document.documentElement.dataset.scheme,
  'pearl',
  '未取消时延后预览照常落地（组件恢复基线前必须先取消）',
)
cancelScheduledPreview()

delete (globalThis as { requestAnimationFrame?: unknown }).requestAnimationFrame
delete (globalThis as { cancelAnimationFrame?: unknown }).cancelAnimationFrame
schedulePreviewThemeScheme('celadon')
assert.equal(document.documentElement.dataset.scheme, 'celadon', '没有 rAF 的环境退回同步写入')

console.log('scheme-onboarding deferred preview: ok')

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
