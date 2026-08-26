import assert from 'node:assert/strict'
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })

try {
  const prefsMod = await server.ssrLoadModule('/src/sources/preferences.ts')
  const catMod = await server.ssrLoadModule('/src/sources/categories.ts')
  const {
    DEFAULT_PREFERENCES,
    DEFAULT_HIDDEN_CATEGORY_IDS,
    normalizePreferences,
    orderedCategories,
    visibleCategories,
    moveCategory,
    reorderCategories,
    setCategoryOrder,
    toggleCategoryVisible,
    toggleCategorySource,
    resetCategorySources,
    resetCategoryLayout,
    updateTypography,
    categorySourceIds,
    hasSourceOverride,
  } = prefsMod
  const { uncoveredSourceIds } = catMod

  const VISIBLE = ['mix', 'hot', 'ent', 'sports', 'tech', 'finance', 'intl', 'health', 'game', 'fun']

  assert.equal(uncoveredSourceIds().length, 0, '每个源至少落入一个分类')
  assert.deepEqual(
    visibleCategories(DEFAULT_PREFERENCES).map((c) => c.id),
    VISIBLE,
    '默认可见应为门户经典 10 栏',
  )
  assert.deepEqual(categorySourceIds('hot', DEFAULT_PREFERENCES), [
    'netease',
    'bbc-zh',
    'scmp-china',
  ])
  assert.deepEqual(categorySourceIds('ent', DEFAULT_PREFERENCES), ['netease-ent'])
  assert.deepEqual(categorySourceIds('tech', DEFAULT_PREFERENCES), [
    'netease-tech',
    'ithome',
    'sspai',
  ])
  assert.deepEqual(categorySourceIds('intl', DEFAULT_PREFERENCES), [
    'bbc-zh',
    'dw-top',
    'scmp-china',
    'france24',
    'aljazeera',
  ])
  assert.deepEqual(
    [...normalizePreferences(null).hiddenCategoryIds].sort(),
    [...DEFAULT_HIDDEN_CATEGORY_IDS].sort(),
    '无持久化数据时应使用默认隐藏',
  )
  console.log('defaults ok')

  let prefs = DEFAULT_PREFERENCES
  const baseOrder = orderedCategories(prefs).map((c) => c.id)
  console.log('categories:', baseOrder.length, baseOrder.slice(0, 6).join(','))

  // 1. 排序：把 tech 上移一位
  const techIndex = baseOrder.indexOf('tech')
  const moved = moveCategory(prefs, 'tech', -1)
  const movedOrder = orderedCategories(moved).map((c) => c.id)
  assert.equal(movedOrder.indexOf('tech'), techIndex - 1, 'tech 应上移一位')
  assert.equal(movedOrder.length, baseOrder.length, '排序不应丢分类')
  console.log('order ok:', movedOrder.slice(0, 4).join(','))

  // 首项不能再上移
  assert.deepEqual(
    orderedCategories(moveCategory(moved, movedOrder[0], -1)).map((c) => c.id),
    movedOrder,
    '首项上移应为空操作',
  )

  // 拖拽重排：把 tech 插到 hot 前面（已在上面）再插回原位附近
  const reordered = reorderCategories(prefs, 'sports', 'hot')
  const reorderedIds = orderedCategories(reordered).map((c) => c.id)
  assert.ok(reorderedIds.indexOf('sports') < reorderedIds.indexOf('hot'), 'sports 应排到 hot 前')
  const setOrder = setCategoryOrder(prefs, ['tech', 'hot', 'mix'])
  assert.deepEqual(orderedCategories(setOrder).map((c) => c.id).slice(0, 3), [
    'tech',
    'hot',
    'mix',
  ])
  console.log('reorder ok')

  // 2. 显示/隐藏
  let hidden = toggleCategoryVisible(prefs, 'ent')
  assert.ok(!visibleCategories(hidden).some((c) => c.id === 'ent'), 'ent 应被隐藏')
  hidden = toggleCategoryVisible(hidden, 'ent')
  assert.ok(visibleCategories(hidden).some((c) => c.id === 'ent'), 'ent 应恢复显示')
  console.log('visibility ok')

  // 全部隐藏应被拦住
  let allHidden = prefs
  for (const c of baseOrder) allHidden = toggleCategoryVisible(allHidden, c)
  assert.ok(visibleCategories(allHidden).length >= 1, '至少保留一个可见分类')
  console.log('guard ok: visible =', visibleCategories(allHidden).length)

  // 3. 分类信源覆盖
  assert.equal(hasSourceOverride('tech', prefs), false)
  let custom = toggleCategorySource(prefs, 'tech', 'netease-digital')
  assert.ok(categorySourceIds('tech', custom).includes('netease-digital'), '应加入数码源')
  assert.equal(hasSourceOverride('tech', custom), true)

  custom = toggleCategorySource(custom, 'tech', 'ithome')
  assert.ok(!categorySourceIds('tech', custom).includes('ithome'), 'IT之家应被移除')

  // 只剩一个时不允许再移除
  let single = prefs
  for (const id of categorySourceIds('tech', prefs).slice(1)) {
    single = toggleCategorySource(single, 'tech', id)
  }
  const last = categorySourceIds('tech', single)
  assert.equal(last.length, 1, '应只剩一个源')
  assert.deepEqual(
    categorySourceIds('tech', toggleCategorySource(single, 'tech', last[0])),
    last,
    '最后一个源不可移除',
  )
  console.log('sources ok: tech =', categorySourceIds('tech', custom).join(','))

  // 综合分类不接受逐分类选源
  assert.deepEqual(toggleCategorySource(prefs, 'mix', 'sspai'), prefs, 'mix 不参与选源')

  // 4. 复位
  assert.equal(hasSourceOverride('tech', resetCategorySources(custom, 'tech')), false)
  const restoredOrder = resetCategoryLayout(toggleCategoryVisible(moved, 'ent'))
  assert.deepEqual(orderedCategories(restoredOrder).map((c) => c.id), baseOrder, '布局应复位')
  const restoredHidden = resetCategoryLayout({
    ...DEFAULT_PREFERENCES,
    categoryOrder: ['tech', 'hot'],
    hiddenCategoryIds: [],
  })
  assert.deepEqual(restoredHidden.categoryOrder, [])
  assert.deepEqual(
    [...restoredHidden.hiddenCategoryIds].sort(),
    [...DEFAULT_HIDDEN_CATEGORY_IDS].sort(),
    '重置布局应恢复默认隐藏而非全部显示',
  )
  console.log('reset ok')

  // 5. 持久化往返 + 脏数据清洗
  const typed = updateTypography(custom, { fontScale: 1.22, fontFamily: 'serif' })
  const roundTrip = normalizePreferences(JSON.parse(JSON.stringify(typed)))
  assert.equal(roundTrip.typography.fontScale, 1.22)
  assert.equal(roundTrip.typography.fontFamily, 'serif')
  assert.deepEqual(categorySourceIds('tech', roundTrip), categorySourceIds('tech', typed))

  const dirty = normalizePreferences({
    categoryOrder: ['tech', 'ghost-category', 'tech'],
    hiddenCategoryIds: ['nope'],
    categorySources: { tech: ['sspai', 'not-a-source'], 'ghost-category': ['sspai'] },
    typography: { fontScale: 99, lineHeight: 'x', fontFamily: 'comic' },
  })
  assert.deepEqual(dirty.categoryOrder, ['tech'], '未知/重复分类应被剔除')
  // 「推荐」已改为动态栏位（不进注册表），归一化不再往隐藏列表补写它
  assert.deepEqual(dirty.hiddenCategoryIds, [])
  assert.deepEqual(dirty.categorySources, { tech: ['sspai'] })
  assert.equal(dirty.typography.fontScale, 1.4, '越界字号应被夹住')
  assert.equal(dirty.typography.lineHeight, 1.9)
  assert.equal(dirty.typography.fontFamily, 'sans')
  console.log('normalize ok')

  console.log('\nALL PREFERENCE CHECKS PASSED')
} finally {
  await server.close()
}
