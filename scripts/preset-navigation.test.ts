import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { defaultFeedCategoryId, DEFAULT_PREFERENCES, visibleCategories } from '../src/sources/preferences'
import {
  BUILTIN_DEFAULT_ID,
  BUILTIN_DEPTH_ID,
  applySnapshotToPrefs,
  findBuiltinPreset,
} from '../src/sources/presets'

function firstCategory(presetId: string): string {
  const preset = findBuiltinPreset(presetId)
  assert.ok(preset, `缺少预设 ${presetId}`)
  return defaultFeedCategoryId(
    visibleCategories(applySnapshotToPrefs(DEFAULT_PREFERENCES, preset.snapshot)),
  )
}

assert.equal(firstCategory(BUILTIN_DEFAULT_ID), 'cn-headlines')
assert.equal(firstCategory(BUILTIN_DEPTH_ID), 'depth-reporting')

const appSource = readFileSync(resolve('src/App.tsx'), 'utf8')
const useFeedsSource = readFileSync(resolve('src/hooks/useFeeds.ts'), 'utf8')

const presetResetEffect = appSource.match(
  /useLayoutEffect\(\(\) => \{[\s\S]*?prevPresetIdRef\.current === activePresetId[\s\S]*?\}, \[activePresetFirstCategoryId, activePresetId\]\)/,
)?.[0]

assert.ok(presetResetEffect, 'App 必须监听活动预设变化')
assert.match(
  presetResetEffect,
  /setCategoryId\(activePresetFirstCategoryId\)/,
  '切换预设必须无条件回到新预设首个普通分类',
)
assert.doesNotMatch(
  presetResetEffect,
  /categoryId === RECOMMEND_CATEGORY_ID/,
  '不能仅在旧分类为推荐栏时才重置',
)
assert.match(
  appSource,
  /<FeedScreen\s+key=\{`preset:\$\{activePresetId\}`\}/,
  '切换预设必须重建信息流，清除旧布局的分类滚动位置',
)
assert.match(
  appSource,
  /useFeeds\(fetchIds,\s*notifyCacheChange,\s*prefs\.customSources,\s*activePresetId\)/,
  '活动预设 id 必须传入 useFeeds，让 feed 生命周期能识别预设切换',
)

const presetRefreshCancelEffect = useFeedsSource.match(
  /useLayoutEffect\(\(\) => \{[\s\S]*?refreshContextRef\.current === refreshContextKey[\s\S]*?cancelActiveRefresh\(\)[\s\S]*?\}, \[cancelActiveRefresh, refreshContextKey\]\)/,
)?.[0]
assert.ok(presetRefreshCancelEffect, 'useFeeds 必须在刷新上下文变化时中止旧预设刷新')

const cancelActiveRefresh = useFeedsSource.match(
  /const cancelActiveRefresh = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[\]\)/,
)?.[0]
assert.ok(cancelActiveRefresh, 'useFeeds 必须集中实现活动刷新取消逻辑')
assert.match(cancelActiveRefresh, /controller\?\.abort\(\)/, '切换预设必须 abort 旧网络刷新')
assert.match(
  cancelActiveRefresh,
  /refreshInFlightRef\.current\s*=\s*false/,
  '取消旧刷新后必须释放 in-flight 锁，否则新预设下拉刷新会被直接忽略',
)
assert.match(cancelActiveRefresh, /setRefreshing\(false\)/, '取消旧刷新后必须结束刷新状态')
assert.match(cancelActiveRefresh, /setRefreshProgress\(null\)/, '旧预设刷新进度不能带到新预设')
assert.match(
  cancelActiveRefresh,
  /status\?\.state !== 'loading'/,
  '取消旧刷新时必须清理仍处于 loading 的旧源状态',
)

console.log('preset-navigation.test.ts: ok')
