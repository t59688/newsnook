/**
 * 同步通知策略：什么值得进 Android 通知栏，什么必须闭嘴。
 * 运行：npm run test:sync-notifier
 */
import assert from 'node:assert/strict'

import {
  mapSyncEventToNotification,
  SYNC_NOTIFICATION_IDS,
  toastForSyncEvent,
  type AppVisibility,
} from '../src/features/sync/notifier'
import type { SyncConflict } from '@newsnook/contracts'
import type { SyncEvent, SyncStatus } from '../src/features/sync/SyncEngine'

const STATUS: SyncStatus = {
  phase: 'idle',
  lastSyncedAt: null,
  lastError: null,
  pendingCount: 0,
  conflictCount: 0,
  nextRetryAt: null,
  firstSyncCompleted: true,
}

const conflict: SyncConflict = {
  id: 'c1',
  entityType: 'subscription',
  entityId: 's1',
  reason: 'delete_vs_update',
  detectedAt: 1_800_000_000_000,
  localSnapshot: null,
  serverSnapshot: null,
}

const BACKGROUND: AppVisibility = 'background'
const FOREGROUND: AppVisibility = 'foreground'

// ---------- 前台永远不用通知栏 ----------

const everyEvent: SyncEvent[] = [
  { type: 'status', status: STATUS },
  { type: 'applied', records: 7 },
  { type: 'first-sync-complete' },
  { type: 'conflicts', conflicts: [conflict] },
  { type: 'failed', code: 'SESSION_EXPIRED', requestId: 'abcdef0123', attempt: 1 },
]

for (const event of everyEvent) {
  assert.equal(
    mapSyncEventToNotification(event, FOREGROUND),
    null,
    `${event.type}: 前台用应用内 Toast，不打通知栏`,
  )
}

console.log('sync-notifier foreground silence: ok')

// ---------- 后台：例行成功也不通知 ----------

assert.equal(mapSyncEventToNotification({ type: 'status', status: STATUS }, BACKGROUND), null)
assert.equal(
  mapSyncEventToNotification({ type: 'applied', records: 12 }, BACKGROUND),
  null,
  '后台自动同步成功是常态，不该刷通知栏',
)
assert.equal(mapSyncEventToNotification({ type: 'conflicts', conflicts: [] }, BACKGROUND), null)

// 反复失败前的偶发失败自己会退避重试
for (let attempt = 1; attempt <= 2; attempt += 1) {
  assert.equal(
    mapSyncEventToNotification(
      { type: 'failed', code: 'SERVICE_UNAVAILABLE', requestId: null, attempt },
      BACKGROUND,
    ),
    null,
    `第 ${attempt} 次失败不通知`,
  )
}

console.log('sync-notifier routine silence: ok')

// ---------- 后台：三类值得通知 ----------

const firstSync = mapSyncEventToNotification({ type: 'first-sync-complete' }, BACKGROUND)
assert.equal(firstSync?.id, SYNC_NOTIFICATION_IDS.firstSync)
assert.equal(firstSync?.route, 'account-sync')
assert.match(firstSync!.title, /同步已开启/)

const conflictNotification = mapSyncEventToNotification(
  { type: 'conflicts', conflicts: [conflict, { ...conflict, id: 'c2' }] },
  BACKGROUND,
)
assert.equal(conflictNotification?.id, SYNC_NOTIFICATION_IDS.conflict)
assert.match(conflictNotification!.body, /2 处改动/)
assert.equal(conflictNotification?.route, 'account-sync', '点开要能直接去处理')

const repeatedFailure = mapSyncEventToNotification(
  { type: 'failed', code: 'SERVICE_UNAVAILABLE', requestId: 'deadbeefcafe', attempt: 3 },
  BACKGROUND,
)
assert.equal(repeatedFailure?.id, SYNC_NOTIFICATION_IDS.failure)
assert.match(repeatedFailure!.body, /编号 deadbeef/)
assert.ok(!repeatedFailure!.body.includes('deadbeefcafe'), '只给短编号')

// 认证类问题第一次就要说：用户不动手同步就停在那里
const expired = mapSyncEventToNotification(
  { type: 'failed', code: 'SESSION_EXPIRED', requestId: null, attempt: 1 },
  BACKGROUND,
)
assert.equal(expired?.id, SYNC_NOTIFICATION_IDS.failure)
assert.match(expired!.body, /重新登录/)

const revoked = mapSyncEventToNotification(
  { type: 'failed', code: 'DEVICE_REVOKED', requestId: null, attempt: 1 },
  BACKGROUND,
)
assert.match(revoked!.body, /本地数据不受影响/)

console.log('sync-notifier actionable notifications: ok')

// ---------- id 稳定：同类反复发生只覆盖一条 ----------

const failAgain = mapSyncEventToNotification(
  { type: 'failed', code: 'NETWORK_ERROR', requestId: 'x1', attempt: 9 },
  BACKGROUND,
)
assert.equal(failAgain?.id, repeatedFailure?.id, '重复失败共用一个通知 id')
assert.equal(
  new Set(Object.values(SYNC_NOTIFICATION_IDS)).size,
  Object.values(SYNC_NOTIFICATION_IDS).length,
  '三类通知 id 互不冲突',
)

// 通知与 Toast 是两套分寸：Toast 更宽松（会说「已同步 N 项」），通知栏不会
assert.ok(toastForSyncEvent({ type: 'applied', records: 3 }))
assert.equal(mapSyncEventToNotification({ type: 'applied', records: 3 }, BACKGROUND), null)

console.log('sync-notifier ids: ok')

// ---------- 通知深链：点开落到「账户与同步」 ----------

const { syncRouteFromAppUrl } = await import('../src/features/sync/nativeNotification')

assert.equal(syncRouteFromAppUrl('newsnook://sync/account-sync'), 'account-sync')
assert.equal(syncRouteFromAppUrl('newsnook://sync/account-sync?from=notification'), 'account-sync')
// 分享深链与其它 scheme 不能被同步误吞
assert.equal(syncRouteFromAppUrl('newsnook://a/abc123'), null)
assert.equal(syncRouteFromAppUrl('https://news.aizeek.com/a/abc123'), null)
assert.equal(syncRouteFromAppUrl('newsnook://sync/unknown'), null)
assert.equal(syncRouteFromAppUrl(''), null)

console.log('sync-notifier deep link: ok')
console.log('sync-notifier: all ok')
