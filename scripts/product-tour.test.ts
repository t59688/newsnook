/**
 * 功能引导：步骤定义合法性、可用步骤过滤、看过标记的存取与重置。
 * 运行：npm run test:product-tour
 */
import assert from 'node:assert/strict'

import { PRODUCT_TOUR_STEPS, resolveAvailableSteps, tourSelector } from '../src/features/productTour/steps'
import type { TourTab } from '../src/features/productTour/types'

// ---------- 步骤定义 ----------

// 引导覆盖核心功能（列表 / 预设 / 自定义订阅 / 翻译 / 设置），上限防止膨胀成负担
assert.ok(PRODUCT_TOUR_STEPS.length >= 5, '引导至少覆盖 5 个步骤')
assert.ok(PRODUCT_TOUR_STEPS.length <= 12, '步骤过多会让引导变成负担')

const ids = PRODUCT_TOUR_STEPS.map((step) => step.id)
assert.equal(new Set(ids).size, ids.length, '步骤 id 不重复')

// 核心功能步骤必须在场（防止改动时被误删）
for (const requiredId of [
  'preset-switcher',
  'me-custom-sources',
  'me-translation',
  'me-presets',
]) {
  assert.ok(ids.includes(requiredId), `核心功能步骤 ${requiredId} 在场`)
}

assert.equal(PRODUCT_TOUR_STEPS[0].id, 'welcome')
assert.equal(PRODUCT_TOUR_STEPS[0].selector, null, '欢迎卡无高亮目标，居中展示')

// 云同步是可选加分项：引导必须继续说明「不用账号也能用」，且不得变成登录向导
assert.match(PRODUCT_TOUR_STEPS[0].description, /无需账号/, '欢迎卡说明账号可选')
for (const step of PRODUCT_TOUR_STEPS) {
  assert.ok(
    !/登录|注册|账户与同步/.test(step.title + step.description),
    `${step.id}: 功能引导不承担登录流程`,
  )
}

const validTabs: TourTab[] = ['today', 'me']
for (const step of PRODUCT_TOUR_STEPS) {
  assert.ok(validTabs.includes(step.tab), `${step.id}: tab 合法`)
  assert.ok(step.title.trim().length > 0, `${step.id}: 标题非空`)
  assert.ok(step.description.trim().length >= 10, `${step.id}: 描述非空且有内容`)
  assert.ok(/[\u4e00-\u9fff]/.test(step.title), `${step.id}: 标题为中文文案`)
  if (step.selector !== null) {
    assert.match(
      step.selector,
      /^\[data-tour="[a-z][a-z-]*"\]$/,
      `${step.id}: 选择器只锚定 data-tour 属性`,
    )
  }
}

// 服务假定「速闻」步骤在前、「我的」步骤在后（切 Tab 只发生一次边界）
const firstMeIndex = PRODUCT_TOUR_STEPS.findIndex((step) => step.tab === 'me')
assert.ok(firstMeIndex > 0, '存在「我的」步骤且不是第一步')
assert.ok(
  PRODUCT_TOUR_STEPS.slice(firstMeIndex).every((step) => step.tab === 'me'),
  '「我的」步骤连续排在末尾',
)

assert.equal(tourSelector('tab-bar'), '[data-tour="tab-bar"]')

console.log('product-tour steps: ok')

// ---------- 可用步骤过滤 ----------

const allVisible = resolveAvailableSteps(PRODUCT_TOUR_STEPS, () => true)
assert.equal(allVisible.length, PRODUCT_TOUR_STEPS.length, '全部可见时不过滤')

const noneVisible = resolveAvailableSteps(PRODUCT_TOUR_STEPS, () => false)
assert.ok(
  noneVisible.every((step) => step.selector === null || step.tab === 'me'),
  '「速闻」目标全部缺席时只剩欢迎卡与「我的」步骤',
)
assert.ok(noneVisible.some((step) => step.id === 'welcome'), '欢迎卡始终保留')
assert.ok(
  noneVisible.some((step) => step.tab === 'me'),
  '「我的」步骤不做即时可见性过滤（切 Tab 后才挂载）',
)

const withoutTabBar = resolveAvailableSteps(
  PRODUCT_TOUR_STEPS,
  (selector) => selector !== tourSelector('tab-bar'),
)
assert.ok(!withoutTabBar.some((step) => step.id === 'tab-bar'), '单个目标缺席时整步跳过')
assert.equal(withoutTabBar.length, PRODUCT_TOUR_STEPS.length - 1, '其余步骤不受影响')

console.log('product-tour step filtering: ok')

// ---------- 看过标记（Node 下垫最小 localStorage） ----------

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

const { hasSeenProductTour, markProductTourSeen, clearProductTourSeen } = await import(
  '../src/lib/storage'
)

assert.equal(hasSeenProductTour(), false, '默认未看过')

markProductTourSeen()
assert.equal(hasSeenProductTour(), true, '完成 / 跳过后标记为看过')
assert.equal(memory.get('newsnook:tour-seen'), 'true', '落在 newsnook: 前缀键上')

// 重看不依赖清标记：标记保持 true 时仍可由「关于」页直接重播
assert.equal(hasSeenProductTour(), true)

clearProductTourSeen()
assert.equal(hasSeenProductTour(), false, '清除后下次冷启动会再次自动引导')
assert.equal(memory.has('newsnook:tour-seen'), false)

console.log('product-tour seen flag: ok')
