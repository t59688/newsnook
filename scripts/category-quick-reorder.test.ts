import assert from 'node:assert/strict'

import { CATEGORIES, FAVORITES_CATEGORY_ID, RECOMMEND_CATEGORY_ID } from '../src/sources/categories'
import {
  DEFAULT_PREFERENCES,
  moveCategory,
  normalizePreferences,
  visibleCategories,
} from '../src/sources/preferences'

const visibleIds = new Set(['cn-headlines', 'cn-select', 'cn-opinion'])
const prefs = {
  ...DEFAULT_PREFERENCES,
  categoryOrder: ['cn-headlines', 'cn-public', 'cn-select', 'cn-dialogue', 'cn-opinion'],
  hiddenCategoryIds: CATEGORIES.map(({ id }) => id).filter((id) => !visibleIds.has(id)),
}
const labels = (next: typeof prefs) => visibleCategories(next).map(({ id }) => id)

assert.deepEqual(labels(prefs), ['cn-headlines', 'cn-select', 'cn-opinion'])

const movedLeft = moveCategory(prefs, 'cn-select', -1)
assert.deepEqual(labels(movedLeft), ['cn-select', 'cn-headlines', 'cn-opinion'],
  '前移应跨越隐藏分类，与用户在首页看到的相邻标签交换')
assert.deepEqual(
  labels(normalizePreferences(JSON.parse(JSON.stringify(movedLeft)))),
  labels(movedLeft),
  '顺序必须经过持久化/归一化后仍保持',
)

const movedRight = moveCategory(prefs, 'cn-select', 1)
assert.deepEqual(labels(movedRight), ['cn-headlines', 'cn-opinion', 'cn-select'],
  '后移应跨越隐藏分类，与用户在首页看到的相邻标签交换')

assert.equal(moveCategory(prefs, 'cn-headlines', -1), prefs, '首个可移动分类不能前移')
assert.equal(moveCategory(prefs, 'cn-opinion', 1), prefs, '末个可移动分类不能后移')
assert.equal(moveCategory(prefs, 'cn-public', 1), prefs, '隐藏分类不接受首页快捷移动')
assert.equal(moveCategory(prefs, FAVORITES_CATEGORY_ID, 1), prefs, '收藏是固定的系统入口')
assert.equal(moveCategory(prefs, RECOMMEND_CATEGORY_ID, -1), prefs, '推荐是固定的系统入口')

console.log('category quick reorder: ok')
