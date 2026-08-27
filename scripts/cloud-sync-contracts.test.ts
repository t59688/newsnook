/**
 * 共享同步协议：版本常量、schema 边界、错误码分类与排序键工具。
 * 运行：npm run test:cloud-contracts
 */
import assert from 'node:assert/strict'

import {
  API_ERROR_CODES,
  HTTP_STATUS_BY_ERROR_CODE,
  MOBILE_AUTH_CALLBACK_URL,
  SYNC_LIMITS,
  SYNC_PROTOCOL_VERSION,
  categoryPayloadSchema,
  isApiErrorCode,
  isFatalErrorCode,
  isRetryableErrorCode,
  rankBetween,
  rankForIndex,
  secretPayloadSchema,
  subscriptionPayloadSchema,
  syncBootstrapReplaceRequestSchema,
  syncConflictResolveRequestSchema,
  syncMutationSchema,
  syncPullQuerySchema,
  syncPullResponseSchema,
  syncPushRequestSchema,
  syncPushResponseSchema,
} from '@newsnook/contracts'

const DEVICE_ID = '8d6f3192-9f48-4cfb-8601-791d28f5513d'
const MUTATION_ID = '0f1f1c3e-6a91-4a2b-9a7c-3a3a2b1c0d9e'

// ---------- 协议版本 ----------

assert.equal(SYNC_PROTOCOL_VERSION, 1)

// ---------- push 请求 ----------

assert.equal(
  syncPushRequestSchema.safeParse({
    protocolVersion: 1,
    deviceId: DEVICE_ID,
    mutations: [],
  }).success,
  true,
  '空批次是合法请求（只想取回 currentRevision）',
)

assert.equal(
  syncPushRequestSchema.safeParse({
    protocolVersion: 2,
    deviceId: 'bad',
    mutations: [],
  }).success,
  false,
  '协议版本与 deviceId 都必须校验',
)

assert.equal(
  syncPushRequestSchema.safeParse({
    protocolVersion: 1,
    deviceId: DEVICE_ID,
    mutations: Array.from({ length: SYNC_LIMITS.maxMutationsPerPush + 1 }, () => ({
      mutationId: MUTATION_ID,
      entityType: 'setting',
      entityId: 'theme',
      operation: 'upsert',
      baseRevision: null,
      payload: { value: 'dark' },
    })),
  }).success,
  false,
  'push 批量有硬上限',
)

const validMutation = syncMutationSchema.safeParse({
  mutationId: MUTATION_ID,
  entityType: 'subscription',
  entityId: 'netease',
  operation: 'upsert',
  baseRevision: 12,
  payload: { kind: 'builtin', enabled: true, sortRank: '000001' },
})
assert.equal(validMutation.success, true)

assert.equal(
  syncMutationSchema.safeParse({
    mutationId: 'not-a-uuid',
    entityType: 'subscription',
    entityId: 'netease',
    operation: 'upsert',
    baseRevision: null,
    payload: {},
  }).success,
  false,
  'mutationId 必须是 UUID（幂等键）',
)

assert.equal(
  syncMutationSchema.safeParse({
    mutationId: MUTATION_ID,
    entityType: 'unknown-entity',
    entityId: 'netease',
    operation: 'upsert',
    baseRevision: null,
    payload: {},
  }).success,
  false,
  '实体类型是封闭集合',
)

// ---------- 各实体 payload ----------

assert.equal(
  subscriptionPayloadSchema.safeParse({
    kind: 'custom',
    enabled: true,
    sortRank: '00000a',
    name: '示例源',
    url: 'https://example.com/feed.xml',
    normalizedUrl: 'example.com/feed.xml',
  }).success,
  true,
)
assert.equal(
  subscriptionPayloadSchema.safeParse({ kind: 'custom', enabled: true, sortRank: 'BAD RANK' }).success,
  false,
  'sortRank 只接受受限字符集',
)

assert.equal(
  categoryPayloadSchema.safeParse({
    kind: 'builtin',
    visible: true,
    sortRank: '000002',
    sourceIds: null,
  }).success,
  true,
  'sourceIds 为 null 表示沿用注册表默认',
)

assert.equal(
  secretPayloadSchema.safeParse({ value: 'x'.repeat(SYNC_LIMITS.maxSecretValueLength + 1) }).success,
  false,
  'Secret 值有长度上限',
)

// ---------- pull ----------

assert.equal(
  syncPullResponseSchema.safeParse({
    records: [],
    cursor: 0,
    currentRevision: 0,
    hasMore: false,
  }).success,
  true,
)

const pullQuery = syncPullQuerySchema.safeParse({ since: '7', limit: '50' })
assert.equal(pullQuery.success, true, 'query string 会被强制转成数字')
assert.equal(pullQuery.success && pullQuery.data.since, 7)
assert.equal(pullQuery.success && pullQuery.data.limit, 50)
assert.equal(
  syncPullQuerySchema.safeParse({ limit: String(SYNC_LIMITS.maxPullLimit + 1) }).success,
  false,
  '分页上限受控',
)
const defaultedQuery = syncPullQuerySchema.safeParse({})
assert.equal(defaultedQuery.success && defaultedQuery.data.since, 0)
assert.equal(defaultedQuery.success && defaultedQuery.data.limit, SYNC_LIMITS.defaultPullLimit)

// ---------- push 响应 / bootstrap / conflict ----------

assert.equal(
  syncPushResponseSchema.safeParse({
    protocolVersion: 1,
    results: [
      {
        mutationId: MUTATION_ID,
        entityType: 'subscription',
        entityId: 'netease',
        status: 'accepted',
        revision: 3,
        conflictId: null,
      },
    ],
    conflicts: [],
    currentRevision: 3,
  }).success,
  true,
)

assert.equal(
  syncBootstrapReplaceRequestSchema.safeParse({
    protocolVersion: 1,
    deviceId: DEVICE_ID,
    entities: [{ entityType: 'setting', entityId: 'theme', payload: { value: 'dark' } }],
  }).success,
  true,
)

assert.equal(
  syncConflictResolveRequestSchema.safeParse({
    protocolVersion: 1,
    deviceId: DEVICE_ID,
    resolution: 'accept_local',
  }).success,
  true,
)
assert.equal(
  syncConflictResolveRequestSchema.safeParse({
    protocolVersion: 1,
    deviceId: DEVICE_ID,
    resolution: 'merge',
  }).success,
  false,
  '冲突处理只有两种明确动作',
)

// ---------- 错误码 ----------

for (const code of API_ERROR_CODES) {
  assert.ok(isApiErrorCode(code))
  assert.ok(
    typeof HTTP_STATUS_BY_ERROR_CODE[code] === 'number',
    `${code} 必须有对应 HTTP status`,
  )
}
assert.equal(isApiErrorCode('NOPE'), false)

for (const required of [
  'AUTH_REQUIRED',
  'SESSION_EXPIRED',
  'DEVICE_REVOKED',
  'DEVICE_IN_USE',
  'SYNC_CONFLICT',
  'SYNC_SCHEMA_UNSUPPORTED',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'VALIDATION_FAILED',
]) {
  assert.ok((API_ERROR_CODES as readonly string[]).includes(required), `${required} 是稳定契约`)
}

assert.equal(isRetryableErrorCode('RATE_LIMITED'), true)
assert.equal(isRetryableErrorCode('SERVICE_UNAVAILABLE'), true)
assert.equal(isRetryableErrorCode('VALIDATION_FAILED'), false)
assert.equal(isFatalErrorCode('SESSION_EXPIRED'), true)
assert.equal(isFatalErrorCode('DEVICE_REVOKED'), true)
assert.equal(isFatalErrorCode('SYNC_CONFLICT'), false)

// ---------- 移动端回调固定目标 ----------

assert.equal(MOBILE_AUTH_CALLBACK_URL, 'newsnook://auth/callback')

// ---------- 排序键 ----------

const first = rankForIndex(0)
const second = rankForIndex(1)
assert.ok(first < second, '序号 rank 递增')

const middle = rankBetween(first, second)
assert.ok(first < middle && middle < second, '两个相邻 rank 之间可插入')

let cursor = rankBetween(first, second)
for (let i = 0; i < 40; i += 1) {
  const next = rankBetween(first, cursor)
  assert.ok(first < next && next < cursor, `第 ${i} 次连续前插仍严格有序`)
  cursor = next
}

assert.ok(rankBetween(null, first) < first, '在最前插入')
assert.ok(rankBetween(second, null) > second, '在最后追加')

console.log('cloud sync contracts: ok')
