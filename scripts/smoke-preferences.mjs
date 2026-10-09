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
  const {
    CATEGORY_TAXONOMY_VERSION,
    DEFAULT_PRESET_CATEGORY_IDS,
    uncoveredSourceIds,
  } = catMod

  const VISIBLE = [...DEFAULT_PRESET_CATEGORY_IDS]

  assert.equal(uncoveredSourceIds().length, 0, '每个普通内置信源至少落入一个分类')
  assert.deepEqual(
    visibleCategories(DEFAULT_PREFERENCES).map((c) => c.id),
    VISIBLE,
    '默认可见应为中国资讯预设',
  )
  assert.deepEqual(categorySourceIds('cn-headlines', DEFAULT_PREFERENCES), ['netease'])
  assert.deepEqual(categorySourceIds('cn-select', DEFAULT_PREFERENCES), [
    'netease-exclusive',
    'netease-select',
  ])
  assert.ok(categorySourceIds('cn-public', DEFAULT_PREFERENCES).includes('netease-gov'))
  assert.ok(categorySourceIds('cn-opinion', DEFAULT_PREFERENCES).includes('thepaper-ideas'))
  assert.deepEqual(
    [...normalizePreferences(null).hiddenCategoryIds].sort(),
    [...DEFAULT_HIDDEN_CATEGORY_IDS].sort(),
    '无持久化数据时应使用默认隐藏',
  )
  console.log('defaults ok')

  let prefs = DEFAULT_PREFERENCES
  const baseOrder = orderedCategories(prefs).map((c) => c.id)
  console.log('categories:', baseOrder.length, baseOrder.slice(0, 6).join(','))

  // 1. 排序
  const publicIndex = baseOrder.indexOf('cn-public')
  const moved = moveCategory(prefs, 'cn-public', -1)
  const movedOrder = orderedCategories(moved).map((c) => c.id)
  assert.equal(movedOrder.indexOf('cn-public'), publicIndex - 1)
  assert.equal(movedOrder.length, baseOrder.length)

  assert.deepEqual(
    orderedCategories(moveCategory(moved, movedOrder[0], -1)).map((c) => c.id),
    movedOrder,
  )

  const reordered = reorderCategories(prefs, 'cn-opinion', 'cn-headlines')
  const reorderedIds = orderedCategories(reordered).map((c) => c.id)
  assert.ok(reorderedIds.indexOf('cn-opinion') < reorderedIds.indexOf('cn-headlines'))

  const setOrder = setCategoryOrder(prefs, ['cn-public', 'cn-headlines', 'mix'])
  assert.deepEqual(orderedCategories(setOrder).map((c) => c.id).slice(0, 3), [
    'cn-public',
    'cn-headlines',
    'mix',
  ])
  console.log('reorder ok')

  // 2. 显示/隐藏
  let hidden = toggleCategoryVisible(prefs, 'cn-dialogue')
  assert.ok(!visibleCategories(hidden).some((c) => c.id === 'cn-dialogue'))
  hidden = toggleCategoryVisible(hidden, 'cn-dialogue')
  assert.ok(visibleCategories(hidden).some((c) => c.id === 'cn-dialogue'))

  let allHidden = prefs
  for (const c of baseOrder) allHidden = toggleCategoryVisible(allHidden, c)
  assert.ok(visibleCategories(allHidden).length >= 1, '至少保留一个可见分类')
  console.log('visibility guard ok')

  // 3. 分类信源覆盖
  assert.equal(hasSourceOverride('cn-public', prefs), true, '内置预设快照显式保存分类源')
  let custom = toggleCategorySource(prefs, 'cn-public', 'netease')
  assert.ok(categorySourceIds('cn-public', custom).includes('netease'))

  custom = toggleCategorySource(custom, 'cn-public', 'netease-gov')
  assert.ok(!categorySourceIds('cn-public', custom).includes('netease-gov'))

  let single = prefs
  for (const id of categorySourceIds('cn-public', prefs).slice(1)) {
    single = toggleCategorySource(single, 'cn-public', id)
  }
  const last = categorySourceIds('cn-public', single)
  assert.equal(last.length, 1)
  assert.deepEqual(
    categorySourceIds('cn-public', toggleCategorySource(single, 'cn-public', last[0])),
    last,
    '最后一个源不可移除',
  )

  assert.deepEqual(toggleCategorySource(prefs, 'mix', 'sspai'), prefs, 'mix 不参与选源')
  console.log('sources ok')

  // 4. 复位
  const resetOne = resetCategorySources(custom, 'cn-public')
  assert.equal(hasSourceOverride('cn-public', resetOne), false)
  assert.deepEqual(categorySourceIds('cn-public', resetOne), ['netease-gov', 'thepaper-research'])

  const restoredOrder = resetCategoryLayout(toggleCategoryVisible(moved, 'cn-dialogue'))
  assert.deepEqual(visibleCategories(restoredOrder).map((c) => c.id), VISIBLE)
  assert.deepEqual(restoredOrder.categoryOrder, VISIBLE)
  assert.deepEqual(
    [...restoredOrder.hiddenCategoryIds].sort(),
    [...DEFAULT_HIDDEN_CATEGORY_IDS].sort(),
  )
  console.log('reset ok')

  // 5. 持久化往返 + 当前 taxonomy 脏数据清洗
  const typed = updateTypography(custom, { fontScale: 1.22, fontFamily: 'serif' })
  const roundTrip = normalizePreferences(JSON.parse(JSON.stringify(typed)))
  assert.equal(roundTrip.typography.fontScale, 1.22)
  assert.equal(roundTrip.typography.fontFamily, 'serif')
  assert.deepEqual(
    categorySourceIds('cn-public', roundTrip),
    categorySourceIds('cn-public', typed),
  )

  const dirty = normalizePreferences({
    categoryTaxonomyVersion: CATEGORY_TAXONOMY_VERSION,
    categoryOrder: ['tech-digital', 'ghost-category', 'tech-digital'],
    hiddenCategoryIds: ['nope'],
    categorySources: {
      'tech-digital': ['ithome', 'not-a-source'],
      'ghost-category': ['sspai'],
    },
    typography: { fontScale: 99, lineHeight: 'x', fontFamily: 'comic' },
  })
  assert.deepEqual(dirty.categoryOrder, ['tech-digital'])
  assert.deepEqual(dirty.hiddenCategoryIds, [])
  assert.deepEqual(dirty.categorySources, { 'tech-digital': ['ithome'] })
  assert.equal(dirty.typography.fontScale, 1.4)
  assert.equal(dirty.typography.lineHeight, 1.9)
  assert.equal(dirty.typography.fontFamily, 'sans')
  console.log('normalize ok')

  console.log('\nALL PREFERENCE CHECKS PASSED')
} finally {
  await server.close()
}
