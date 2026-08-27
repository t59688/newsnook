/**
 * 账户与同步的界面表达层：状态文案、Toast 分寸、首次同步三选一、
 * 设备描述、屏幕状态机。全部是纯函数断言，不渲染 React。
 * 运行：npm run test:account-sync-ui
 */
import assert from 'node:assert/strict'

import { accountScreenModel } from '../src/features/account/screenModel'
import { describeDevice } from '../src/features/sync/devices'
import { countProjection, decideFirstSync, describeCounts } from '../src/features/sync/firstSync'
import {
  NOISY_FAILURE_ATTEMPT,
  relativeTime,
  shortRequestId,
  syncStatusCaption,
  toastForSyncEvent,
} from '../src/features/sync/notifier'
import type { SyncStatus } from '../src/features/sync/SyncEngine'
import type { LocalProjection } from '../src/features/sync/types'

const IDLE: SyncStatus = {
  phase: 'idle',
  lastSyncedAt: null,
  lastError: null,
  pendingCount: 0,
  conflictCount: 0,
  nextRetryAt: null,
  firstSyncCompleted: false,
}

function status(patch: Partial<SyncStatus>): SyncStatus {
  return { ...IDLE, ...patch }
}

// ---------- 状态文案 ----------

// 未登录是完全正常的稳定态，措辞必须让人放心，不能像出错
const anonymous = syncStatusCaption(IDLE, { authenticated: false })
assert.match(anonymous, /未登录/)
assert.match(anonymous, /本地阅读不受影响/)

assert.equal(
  syncStatusCaption(status({ phase: 'syncing' }), { authenticated: true }),
  '正在同步…',
)
assert.match(
  syncStatusCaption(status({ phase: 'offline' }), { authenticated: true }),
  /离线/,
)
assert.match(
  syncStatusCaption(status({ phase: 'paused' }), { authenticated: true }),
  /重新登录/,
)
assert.match(
  syncStatusCaption(status({ phase: 'needs-first-sync' }), { authenticated: true }),
  /首次同步/,
)

// 冲突优先于「待上传」，待上传优先于「上次同步」：先说需要人管的事
assert.match(
  syncStatusCaption(status({ conflictCount: 2, pendingCount: 5, firstSyncCompleted: true }), {
    authenticated: true,
  }),
  /2 处冲突待处理/,
)
assert.match(
  syncStatusCaption(status({ pendingCount: 5, firstSyncCompleted: true }), { authenticated: true }),
  /5 项改动待上传/,
)

const now = 1_800_000_000_000
assert.equal(
  syncStatusCaption(status({ lastSyncedAt: now - 3 * 60_000, firstSyncCompleted: true }), {
    authenticated: true,
    now,
  }),
  '上次同步 3 分钟前',
)

// 出错时给短编号方便对日志，但不带任何 payload
const errored = syncStatusCaption(
  status({
    phase: 'error',
    lastError: { code: 'SERVICE_UNAVAILABLE', message: 'boom', requestId: 'abcdef0123456789' },
  }),
  { authenticated: true },
)
assert.match(errored, /编号 abcdef01/)
assert.ok(!errored.includes('abcdef0123456789'), '只暴露短编号')
assert.equal(shortRequestId(null), null)

assert.equal(relativeTime(now, now), '刚刚')
assert.equal(relativeTime(now - 90 * 60_000, now), '1 小时前')
assert.equal(relativeTime(now - 50 * 3600_000, now), '2 天前')

console.log('account-sync captions: ok')

// ---------- Toast 分寸 ----------

// 后台自动同步成功是常态，绝不打扰
assert.equal(toastForSyncEvent({ type: 'applied', records: 0 }), null)
assert.equal(toastForSyncEvent({ type: 'status', status: IDLE }), null)
assert.equal(toastForSyncEvent({ type: 'conflicts', conflicts: [] }), null)

const applied = toastForSyncEvent({ type: 'applied', records: 3 })
assert.equal(applied?.tone, 'info')
assert.match(applied!.text, /3 项/)
assert.equal(applied?.action, undefined, '普通同步结果不需要用户跳转')

assert.equal(toastForSyncEvent({ type: 'first-sync-complete' })?.tone, 'success')

const conflicts = toastForSyncEvent({
  type: 'conflicts',
  conflicts: [
    {
      id: 'c1',
      entityType: 'subscription',
      entityId: 's1',
      reason: 'delete_vs_update',
      detectedAt: now,
      localSnapshot: null,
      serverSnapshot: null,
    },
  ],
})
assert.equal(conflicts?.tone, 'warn')
assert.equal(conflicts?.action, 'open-account-sync', '冲突要给一个能去处理的入口')

// 偶发失败自己退避重试，不该每次都弹
for (let attempt = 1; attempt < NOISY_FAILURE_ATTEMPT; attempt += 1) {
  assert.equal(
    toastForSyncEvent({ type: 'failed', code: 'NETWORK_ERROR', requestId: null, attempt }),
    null,
    `第 ${attempt} 次网络失败不打扰`,
  )
}
const noisy = toastForSyncEvent({
  type: 'failed',
  code: 'NETWORK_ERROR',
  requestId: null,
  attempt: NOISY_FAILURE_ATTEMPT,
})
assert.equal(noisy?.tone, 'error')
assert.equal(noisy?.action, undefined, '网络问题会自愈，不催用户操作')

// 认证类问题第一次就必须说，而且要能直接跳过去处理
const fatal = toastForSyncEvent({
  type: 'failed',
  code: 'SESSION_EXPIRED',
  requestId: 'ff00aa11bb',
  attempt: 1,
})
assert.equal(fatal?.tone, 'error')
assert.equal(fatal?.action, 'open-account-sync')
assert.match(fatal!.text, /编号 ff00aa11/)

const revoked = toastForSyncEvent({
  type: 'failed',
  code: 'DEVICE_REVOKED',
  requestId: null,
  attempt: 1,
})
assert.match(revoked!.text, /本地数据不受影响/, '撤销设备要明确本机数据安全')

console.log('account-sync toasts: ok')

// ---------- 首次同步三选一 ----------

function projection(entries: Array<[string, LocalProjection[string]['entityType']]>): LocalProjection {
  const out: LocalProjection = {}
  for (const [id, entityType] of entries) {
    out[`${entityType}:${id}`] = {
      entityType,
      entityId: id,
      payload: {},
      fingerprint: `fp-${id}`,
    } as LocalProjection[string]
  }
  return out
}

const localOnly = projection([
  ['a', 'subscription'],
  ['b', 'subscription'],
  ['tech', 'category'],
  ['prefs', 'setting'],
])
assert.deepEqual(countProjection(localOnly), {
  subscriptions: 2,
  categories: 1,
  settings: 1,
  secrets: 0,
})
assert.equal(describeCounts(countProjection(localOnly)), '2 订阅 · 1 分类 · 1 项设置')

const emptyCloud = {
  protocolVersion: 1,
  revision: 0,
  counts: { subscriptions: 0, categories: 0, settings: 0, secrets: 0 },
  entities: [],
  lastUpdatedAt: null,
}

// 云端空：本机是唯一数据源，不必打扰用户
const freshCloud = decideFirstSync(localOnly, emptyCloud)
assert.equal(freshCloud.mustAsk, false)
assert.equal(freshCloud.suggestion, 'local')

// 本机空（新装设备）：直接用云端也不会丢东西
const freshDevice = decideFirstSync(
  {},
  { ...emptyCloud, revision: 9, counts: { subscriptions: 4, categories: 2, settings: 1, secrets: 1 } },
)
assert.equal(freshDevice.mustAsk, false)
assert.equal(freshDevice.suggestion, 'cloud')

// 两边都有内容：必须由用户选一次，绝不自动覆盖
const bothPopulated = decideFirstSync(localOnly, {
  ...emptyCloud,
  revision: 12,
  counts: { subscriptions: 3, categories: 2, settings: 1, secrets: 0 },
  lastUpdatedAt: now - 3600_000,
})
assert.equal(bothPopulated.mustAsk, true)
assert.equal(bothPopulated.suggestion, 'merge')
assert.equal(bothPopulated.cloudLastUpdatedAt, now - 3600_000)

// 只有设置（新装的默认值）不算「有内容」，否则每台新设备都要被问一次
const defaultsOnly = decideFirstSync(projection([['prefs', 'setting']]), {
  ...emptyCloud,
  revision: 3,
  counts: { subscriptions: 2, categories: 1, settings: 1, secrets: 0 },
})
assert.equal(defaultsOnly.mustAsk, false)
assert.equal(defaultsOnly.suggestion, 'cloud')

console.log('account-sync first-sync decision: ok')

// ---------- 屏幕状态机 ----------

assert.deepEqual(
  accountScreenModel({
    accountStatus: 'restoring',
    firstSyncCompleted: false,
    conflictCount: 0,
    hasSafetySnapshot: false,
  }),
  { view: 'restoring', actions: [] },
)

const anon = accountScreenModel({
  accountStatus: 'anonymous',
  firstSyncCompleted: false,
  conflictCount: 0,
  hasSafetySnapshot: false,
})
assert.equal(anon.view, 'anonymous')
for (const action of ['sign-in', 'sign-up', 'forgot-password', 'social-sign-in'] as const) {
  assert.ok(anon.actions.includes(action), `未登录态提供 ${action}`)
}
assert.ok(!anon.actions.includes('sync-now'), '未登录不给同步动作')

const firstSync = accountScreenModel({
  accountStatus: 'authenticated',
  firstSyncCompleted: false,
  conflictCount: 0,
  hasSafetySnapshot: false,
})
assert.equal(firstSync.view, 'first-sync')
assert.deepEqual(firstSync.actions, ['adopt-local', 'adopt-cloud', 'adopt-merge'])

const ready = accountScreenModel({
  accountStatus: 'authenticated',
  firstSyncCompleted: true,
  conflictCount: 0,
  hasSafetySnapshot: false,
})
assert.equal(ready.view, 'ready')
assert.ok(!ready.actions.includes('resolve-conflicts'), '没有冲突时不显示冲突区')
assert.ok(!ready.actions.includes('rollback-snapshot'), '没有快照时不显示回滚')
for (const action of ['sync-now', 'manage-devices', 'link-social', 'sign-out'] as const) {
  assert.ok(ready.actions.includes(action), `日常态提供 ${action}`)
}

const busy = accountScreenModel({
  accountStatus: 'authenticated',
  firstSyncCompleted: true,
  conflictCount: 2,
  hasSafetySnapshot: true,
})
assert.ok(busy.actions.includes('resolve-conflicts'))
assert.ok(busy.actions.includes('rollback-snapshot'))

console.log('account-sync screen model: ok')

// ---------- 设备描述 ----------

assert.equal(
  describeDevice(
    {
      id: 'd1',
      name: 'Pixel',
      platform: 'android',
      appVersion: '1.6.8',
      lastSeenAt: now - 60_000,
      createdAt: now - 86_400_000,
      revokedAt: null,
      current: true,
    },
    now,
  ),
  'Android · 刚刚活跃',
)
assert.equal(
  describeDevice(
    {
      id: 'd2',
      name: null,
      platform: 'web',
      appVersion: null,
      lastSeenAt: now - 3 * 3600_000,
      createdAt: now - 86_400_000,
      revokedAt: now - 60_000,
      current: false,
    },
    now,
  ),
  '网页 · 已撤销',
)

console.log('account-sync devices: ok')
console.log('account-sync ui: all ok')
