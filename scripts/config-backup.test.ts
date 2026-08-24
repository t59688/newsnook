import assert from 'node:assert/strict'

import {
  BACKUP_FORMAT,
  BACKUP_SECTIONS,
  BACKUP_VERSION,
  backupFileName,
  collectBackup,
  parseBackup,
  restoreBackup,
  serializeBackup,
  summarizeBackup,
} from '../src/lib/backup'
import {
  READING_POSITION_LIMIT,
  normalizeReadingPositions,
  resetReadingPositionCache,
  resolveScrollTop,
  withPosition,
} from '../src/lib/readingPosition'
import { DEFAULT_PREFERENCES, addCustomSource } from '../src/sources/preferences'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()

  get length(): number {
    return this.values.size
  }

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }

  setItem(key: string, value: string): void {
    this.values.set(key, String(value))
  }
}

const memory = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memory })

console.log('Testing config backup & reading position...')

// —— 阅读位置：纯函数 ——

// 1. 顶部附近不值得记忆
assert.deepEqual(withPosition({}, 'a1', { scrollTop: 40 }), {})

// 2. 正常记录带上可滚动高度
const afterFirst = withPosition({}, 'a1', { scrollTop: 900, scrollRange: 4000 }, 1000)
assert.equal(afterFirst.a1?.scrollTop, 900)
assert.equal(afterFirst.a1?.scrollRange, 4000)
assert.equal(afterFirst.a1?.updatedAt, 1000)

// 3. 重复写同一位置返回原表，调用方可跳过落盘
assert.strictEqual(
  withPosition(afterFirst, 'a1', { scrollTop: 900, scrollRange: 4000 }, 2000),
  afterFirst,
)

// 4. 读到结尾就忘掉，下次从头开始
assert.equal('a1' in withPosition(afterFirst, 'a1', { scrollTop: 3960, scrollRange: 4000 }), false)

// 5. 墨水屏首页同样视为「没开始读」，非首页才记
assert.deepEqual(withPosition({}, 'a1', { scrollTop: 0, pageIndex: 0 }), {})
assert.equal(withPosition({}, 'a1', { scrollTop: 0, pageIndex: 3 }).a1?.pageIndex, 3)

// 6. 容量上限按最近更新淘汰
let big: Record<string, { scrollTop: number; updatedAt: number }> = {}
for (let i = 0; i < READING_POSITION_LIMIT + 20; i += 1) {
  big = withPosition(big, `id-${i}`, { scrollTop: 500 + i }, 1000 + i)
}
assert.equal(Object.keys(big).length, READING_POSITION_LIMIT)
assert.equal('id-0' in big, false)
assert.ok(`id-${READING_POSITION_LIMIT + 19}` in big)

// 7. 高度变了按比例折算
assert.equal(resolveScrollTop({ scrollTop: 1000, scrollRange: 4000, updatedAt: 0 }, 2000), 500)
assert.equal(resolveScrollTop({ scrollTop: 1000, scrollRange: 4000, updatedAt: 0 }, 4000), 1000)
// 没记录过高度时直接夹到当前范围内
assert.equal(resolveScrollTop({ scrollTop: 9999, updatedAt: 0 }, 1200), 1200)

// 8. 脏数据不会污染运行态
assert.deepEqual(normalizeReadingPositions(null), {})
assert.deepEqual(normalizeReadingPositions([1, 2]), {})
assert.deepEqual(
  normalizeReadingPositions({ ok: { scrollTop: 700, updatedAt: 5 }, bad: { scrollTop: 'x' } }),
  { ok: { scrollTop: 700, updatedAt: 5 } },
)

console.log('✓ reading position pure helpers')

// —— 备份：采集 / 解析 / 恢复 ——

const { nextPrefs } = addCustomSource(
  DEFAULT_PREFERENCES,
  {
    name: '阮一峰的网络日志',
    label: '阮一峰',
    url: 'https://www.ruanyifeng.com/blog/atom.xml',
  },
  'tech',
)

memory.setItem('newsnook:preferences', JSON.stringify(nextPrefs))
memory.setItem('newsnook:enabled', JSON.stringify(['sspai', 'ithome']))
memory.setItem('newsnook:read', JSON.stringify(['r1', 'r2', 'r3']))
memory.setItem(
  'newsnook:later-items',
  JSON.stringify([
    {
      id: 'later-1',
      title: '一篇稍后读',
      summary: '摘要',
      contentHtml: '<p>正文不该进备份</p>',
      publishedAt: 1,
      hasRealDate: true,
      sourceId: 'demo',
      sourceName: '示例',
      sourceLabel: '示',
      sourceGroup: 'cn',
      originUrl: 'https://example.com/later-1',
    },
  ]),
)
memory.setItem(
  'newsnook:reading-pos',
  JSON.stringify({ 'later-1': { scrollTop: 640, scrollRange: 3000, updatedAt: 12 } }),
)
resetReadingPositionCache()

const payload = collectBackup('9.9.9')
assert.equal(payload.format, BACKUP_FORMAT)
assert.equal(payload.version, BACKUP_VERSION)
assert.equal(payload.appVersion, '9.9.9')
assert.deepEqual(payload.data.enabledSources, ['sspai', 'ithome'])
assert.equal(payload.data.readIds?.length, 3)
assert.equal(payload.data.laterItems?.length, 1)
// 正文可再生，备份只留元数据
assert.equal('contentHtml' in payload.data.laterItems![0], false)
assert.ok(payload.data.readingPositions)

// 9. 序列化 → 解析 往返无损
const parsed = parseBackup(serializeBackup(payload))
assert.equal(parsed.format, BACKUP_FORMAT)
assert.deepEqual(parsed.data.enabledSources, ['sspai', 'ithome'])
assert.equal(parsed.data.laterItems?.length, 1)

const summary = summarizeBackup(parsed)
assert.equal(summary.customSourceCount, 1)
assert.equal(summary.enabledSourceCount, 2)
assert.equal(summary.laterCount, 1)
assert.equal(summary.readCount, 3)
assert.equal(summary.readingPositionCount, 1)
assert.equal(summary.present.preferences, true)
assert.equal(summary.present.presets, false)

console.log('✓ backup collect / serialize / parse roundtrip')

// 10. 拒绝陌生格式与未来版本
assert.throws(() => parseBackup('not json'), /JSON/)
assert.throws(() => parseBackup(JSON.stringify({ hello: 'world' })), /有所闻/)
assert.throws(
  () => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 99, data: { readIds: ['x'] } })),
  /更新的版本/,
)
assert.throws(
  () => parseBackup(JSON.stringify({ format: BACKUP_FORMAT, version: 1, data: {} })),
  /没有任何可恢复的配置/,
)

// 11. 只恢复所选分区，其它键保持原样
memory.setItem('newsnook:enabled', JSON.stringify(['changed']))
memory.setItem('newsnook:read', JSON.stringify([]))
const result = await restoreBackup(parsed, ['enabledSources'])
assert.deepEqual(result.restored, ['enabledSources'])
assert.deepEqual(JSON.parse(memory.getItem('newsnook:enabled')!), ['sspai', 'ithome'])
assert.deepEqual(JSON.parse(memory.getItem('newsnook:read')!), [])

// 12. 全量恢复覆盖所有存在的分区
const full = await restoreBackup(parsed, BACKUP_SECTIONS)
assert.ok(full.restored.includes('preferences'))
assert.ok(full.restored.includes('readIds'))
assert.ok(full.restored.includes('readingPositions'))
// 备份里没有预设，跳过而不是写空壳
assert.ok(full.skipped.includes('presets'))
assert.equal(memory.getItem('newsnook:presets'), null)
assert.deepEqual(JSON.parse(memory.getItem('newsnook:read')!), ['r1', 'r2', 'r3'])
const restoredPrefs = JSON.parse(memory.getItem('newsnook:preferences')!)
assert.equal(restoredPrefs.customSources.length, 1)
assert.equal(restoredPrefs.customSources[0].name, '阮一峰的网络日志')

// 13. 脏偏好在写盘前被 normalize 兜住
const dirty = parseBackup(
  JSON.stringify({
    format: BACKUP_FORMAT,
    version: 1,
    exportedAt: 1,
    data: { preferences: { categoryOrder: 'nope', hiddenCategoryIds: [1, 2], typography: null } },
  }),
)
await restoreBackup(dirty, ['preferences'])
const healed = JSON.parse(memory.getItem('newsnook:preferences')!)
assert.ok(Array.isArray(healed.categoryOrder))
assert.equal(typeof healed.typography.fontScale, 'number')

// 14. 文件名带时间戳，便于多份备份并存
assert.equal(backupFileName(new Date(2026, 7, 24, 4, 5)), 'newsnook-backup-20260824-0405.json')

console.log('Config backup & reading position tests: ALL PASSED')
