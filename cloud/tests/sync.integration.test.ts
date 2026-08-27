/**
 * 同步引擎集成测试：真实 PostgreSQL，覆盖 revision 分配、串行 push、幂等重放、
 * 冲突分类、delta pull 分页、tombstone 传播、bootstrap 基线替换、设备撤销与越权访问。
 *
 * 每个用例用独立的 remoteAddress，避免共享 IP 触发路由限流而掩盖真实断言。
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'

import type { LightMyRequestResponse } from 'fastify'

import {
  SYNC_LIMITS,
  SYNC_PROTOCOL_VERSION,
  syncPullResponseSchema,
  syncPushResponseSchema,
  type SyncMutation,
  type SyncPullResponse,
  type SyncPushResponse,
  type SyncRecord,
} from '@newsnook/contracts'

import { createSecretCipher } from '../src/crypto/secrets.js'
import { SyncService } from '../src/sync/service.js'
import {
  authHeaders,
  createSignedInUser,
  skipWithoutDatabase,
  startTestCloud,
  type SignedInUser,
  type TestCloud,
} from './helpers.js'

let ipCounter = 0

/** 每个请求一个来源 IP：限流按 IP 计数，测试之间不应互相干扰 */
function nextIp(): string {
  ipCounter += 1
  return `10.${Math.floor(ipCounter / 65536) % 256}.${Math.floor(ipCounter / 256) % 256}.${ipCounter % 256}`
}

// --------------------------------------------------------------- payload 构造

function subscriptionPayload(overrides: Record<string, unknown> = {}): unknown {
  return { kind: 'builtin', enabled: true, sortRank: '000001', ...overrides }
}

function categoryPayload(overrides: Record<string, unknown> = {}): unknown {
  return { kind: 'builtin', visible: true, sortRank: '000001', sourceIds: null, ...overrides }
}

function upsert(
  entityType: SyncMutation['entityType'],
  entityId: string,
  payload: unknown,
  baseRevision: number | null = null,
): SyncMutation {
  return { mutationId: randomUUID(), entityType, entityId, operation: 'upsert', baseRevision, payload }
}

function remove(
  entityType: SyncMutation['entityType'],
  entityId: string,
  baseRevision: number | null,
): SyncMutation {
  return {
    mutationId: randomUUID(),
    entityType,
    entityId,
    operation: 'delete',
    baseRevision,
    payload: null,
  }
}

// ------------------------------------------------------------------ HTTP 辅助

let cloud: TestCloud

function pushRaw(
  user: SignedInUser,
  mutations: SyncMutation[],
  overrides: Record<string, unknown> = {},
): Promise<LightMyRequestResponse> {
  return cloud.app.inject({
    method: 'POST',
    url: '/api/v1/sync/push',
    headers: authHeaders(user),
    remoteAddress: nextIp(),
    payload: {
      protocolVersion: SYNC_PROTOCOL_VERSION,
      deviceId: user.deviceId,
      mutations,
      ...overrides,
    },
  })
}

async function push(user: SignedInUser, mutations: SyncMutation[]): Promise<SyncPushResponse> {
  const response = await pushRaw(user, mutations)
  assert.equal(response.statusCode, 200, response.body)
  const parsed = syncPushResponseSchema.safeParse(response.json())
  assert.ok(parsed.success, `push 响应必须符合协议: ${response.body}`)
  return parsed.data
}

async function pull(user: SignedInUser, since = 0, limit?: number): Promise<SyncPullResponse> {
  const query = limit === undefined ? `since=${since}` : `since=${since}&limit=${limit}`
  const response = await cloud.app.inject({
    method: 'GET',
    url: `/api/v1/sync/pull?${query}`,
    headers: authHeaders(user),
    remoteAddress: nextIp(),
  })
  assert.equal(response.statusCode, 200, response.body)
  const parsed = syncPullResponseSchema.safeParse(response.json())
  assert.ok(parsed.success, `pull 响应必须符合协议: ${response.body}`)
  return parsed.data
}

/** 把分页拉完，模拟客户端的循环 */
async function pullAll(user: SignedInUser, limit: number): Promise<SyncRecord[]> {
  const records: SyncRecord[] = []
  let cursor = 0
  for (let page = 0; page < 50; page += 1) {
    const result = await pull(user, cursor, limit)
    records.push(...result.records)
    cursor = result.cursor
    if (!result.hasMore) return records
  }
  assert.fail('分页没有在合理页数内收敛')
}

async function headRevision(user: SignedInUser): Promise<number> {
  const { rows } = await cloud.pools.app.query<{ current_revision: string }>(
    'SELECT current_revision FROM sync_heads WHERE user_id = $1',
    [user.userId],
  )
  return Number(rows[0]?.current_revision ?? 0)
}

function findRecord(
  records: SyncRecord[],
  entityType: string,
  entityId: string,
): SyncRecord | undefined {
  return records.find((record) => record.entityType === entityType && record.entityId === entityId)
}

// ------------------------------------------------------------------ push 引擎

describe('sync push engine', { skip: skipWithoutDatabase }, () => {
  before(async () => {
    cloud = await startTestCloud()
  })

  after(async () => {
    await cloud?.close()
  })

  it('allocates strictly increasing revisions across pushes', async () => {
    const user = await createSignedInUser(cloud, 'rev')

    const first = await push(user, [
      upsert('subscription', 'builtin:hackernews', subscriptionPayload()),
      upsert('setting', 'typography', { value: { fontSize: 18 } }),
    ])
    assert.deepEqual(
      first.results.map((result) => result.revision),
      [1, 2],
    )
    assert.equal(first.currentRevision, 2)

    const second = await push(user, [upsert('category', 'tech', categoryPayload())])
    assert.equal(second.results[0]?.revision, 3)
    assert.equal(second.currentRevision, 3)
    assert.equal(await headRevision(user), 3)
  })

  it('serializes concurrent pushes for the same user', async () => {
    const user = await createSignedInUser(cloud, 'concurrent')

    const batch = (prefix: string): SyncMutation[] =>
      Array.from({ length: 4 }, (_, index) =>
        upsert('setting', `${prefix}-${index}`, { value: index }),
      )

    const [left, right] = await Promise.all([
      push(user, batch('left')),
      push(user, batch('right')),
    ])

    const revisions = [...left.results, ...right.results].map((result) => result.revision)
    assert.equal(new Set(revisions).size, 8, 'revision 不能重复')
    assert.deepEqual([...revisions].sort((a, b) => Number(a) - Number(b)), [1, 2, 3, 4, 5, 6, 7, 8])
    assert.equal(await headRevision(user), 8)
  })

  it('keeps revisions independent between users', async () => {
    const alice = await createSignedInUser(cloud, 'alice')
    const bob = await createSignedInUser(cloud, 'bob')

    await push(alice, [
      upsert('setting', 'theme', { value: 'dark' }),
      upsert('setting', 'scheme', { value: 'ink' }),
    ])
    const bobPush = await push(bob, [upsert('setting', 'theme', { value: 'light' })])

    assert.equal(bobPush.currentRevision, 1, '另一个用户的 revision 从头开始')
    assert.equal(await headRevision(alice), 2)
    assert.equal(await headRevision(bob), 1)
  })

  it('replays a mutation id without allocating a new revision', async () => {
    const user = await createSignedInUser(cloud, 'replay')
    const mutation = upsert('setting', 'typography', { value: { fontSize: 20 } })

    const first = await push(user, [mutation])
    assert.equal(first.results[0]?.status, 'accepted')
    assert.equal(first.results[0]?.revision, 1)

    // 客户端没收到响应就重发同一批：服务端必须返回原结果而不是再写一版
    const replay = await push(user, [mutation])
    assert.equal(replay.results[0]?.status, 'accepted')
    assert.equal(replay.results[0]?.revision, 1)
    assert.equal(replay.currentRevision, 1)
    assert.equal(await headRevision(user), 1)

    const { rows } = await cloud.pools.app.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM sync_mutations WHERE user_id = $1',
      [user.userId],
    )
    assert.equal(rows[0]?.total, '1')
  })

  it('treats deleting an unknown entity as a no-op', async () => {
    const user = await createSignedInUser(cloud, 'noop')
    const result = await push(user, [remove('subscription', 'never-existed', null)])

    assert.equal(result.results[0]?.status, 'noop')
    assert.equal(result.currentRevision, 0, 'noop 不消耗 revision')
    assert.equal(await headRevision(user), 0)
  })

  it('accepts three mutations and records one conflict in the same batch', async () => {
    const user = await createSignedInUser(cloud, 'mixed')

    const seeded = await push(user, [upsert('category', 'tech', categoryPayload())])
    const categoryRevision = seeded.results[0]!.revision!
    // 另一台设备先改了这个分类，本机还停在旧 revision 上
    await push(user, [
      upsert('category', 'tech', categoryPayload({ visible: false }), categoryRevision),
    ])

    const result = await push(user, [
      upsert('subscription', 'builtin:36kr', subscriptionPayload()),
      upsert('setting', 'theme', { value: 'dark' }),
      upsert('secret', 'translation.openai.apiKey', { value: 'sk-mixed-batch' }),
      upsert('category', 'tech', categoryPayload({ visible: true }), categoryRevision),
    ])

    const statuses = result.results.map((entry) => entry.status)
    assert.deepEqual(statuses, ['accepted', 'accepted', 'accepted', 'conflict'])
    assert.equal(result.conflicts.length, 1)
    assert.equal(result.conflicts[0]?.reason, 'category_stale_mutation')
    assert.equal(result.results[3]?.conflictId, result.conflicts[0]?.id)
    assert.equal(result.currentRevision, 5, '冲突不占用 revision')
  })

  it('conflicts on a stale subscription delete but accepts a stale subscription update', async () => {
    const user = await createSignedInUser(cloud, 'sub-conflict')

    const created = await push(user, [upsert('subscription', 'feed:a', subscriptionPayload())])
    const base = created.results[0]!.revision!
    await push(user, [
      upsert('subscription', 'feed:a', subscriptionPayload({ enabled: false }), base),
    ])

    // 删除会让别的设备刚做的修改消失：必须交给用户裁决
    const staleDelete = await push(user, [remove('subscription', 'feed:a', base)])
    assert.equal(staleDelete.results[0]?.status, 'conflict')
    assert.equal(staleDelete.conflicts[0]?.reason, 'delete_vs_update')

    // 纯字段更新可以自动收敛，不打扰用户
    const staleUpdate = await push(user, [
      upsert('subscription', 'feed:a', subscriptionPayload({ enabled: true }), base),
    ])
    assert.equal(staleUpdate.results[0]?.status, 'accepted')
  })

  it('conflicts when an update lands on a tombstone', async () => {
    const user = await createSignedInUser(cloud, 'resurrect')

    const created = await push(user, [upsert('subscription', 'feed:b', subscriptionPayload())])
    const base = created.results[0]!.revision!
    await push(user, [remove('subscription', 'feed:b', base)])

    const resurrect = await push(user, [
      upsert('subscription', 'feed:b', subscriptionPayload({ enabled: false }), base),
    ])
    assert.equal(resurrect.results[0]?.status, 'conflict')
    assert.equal(resurrect.conflicts[0]?.reason, 'update_vs_delete')
  })

  it('lets settings and secrets converge on server commit order', async () => {
    const user = await createSignedInUser(cloud, 'converge')

    const created = await push(user, [upsert('setting', 'theme', { value: 'dark' })])
    const base = created.results[0]!.revision!
    await push(user, [upsert('setting', 'theme', { value: 'light' }, base)])

    // 明知落后仍然接受：设置类分歧自动收敛，最后提交的生效
    const stale = await push(user, [upsert('setting', 'theme', { value: 'sepia' }, base)])
    assert.equal(stale.results[0]?.status, 'accepted')

    const records = await pullAll(user, 100)
    assert.deepEqual(findRecord(records, 'setting', 'theme')?.payload, { value: 'sepia' })
  })

  it('rolls the whole transaction back when one mutation fails validation', async () => {
    const user = await createSignedInUser(cloud, 'rollback')

    const response = await pushRaw(user, [
      upsert('setting', 'theme', { value: 'dark' }),
      // sortRank 缺失 → 写库前的 schema 校验抛错，整个事务回滚
      upsert('subscription', 'feed:broken', { kind: 'builtin', enabled: true }),
    ])

    assert.equal(response.statusCode, 400)
    assert.equal(response.json().code, 'VALIDATION_FAILED')

    assert.equal(await headRevision(user), 0, '失败的 push 不能推进 head')
    const records = await pullAll(user, 100)
    assert.equal(records.length, 0, '批次里先处理的 mutation 也必须回滚')

    const { rows } = await cloud.pools.app.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM sync_mutations WHERE user_id = $1',
      [user.userId],
    )
    assert.equal(rows[0]?.total, '0', '幂等记录随事务一起回滚，重试才能成功')
  })

  it('emits a push summary that carries counters but no payload or secret value', async () => {
    const user = await createSignedInUser(cloud, 'summary')
    const service = new SyncService({
      pool: cloud.pools.app,
      cipher: createSecretCipher(cloud.config.dataEncryptionKey),
    })

    const { summary } = await service.push(user.userId, {
      protocolVersion: SYNC_PROTOCOL_VERSION,
      deviceId: user.deviceId,
      mutations: [
        upsert('secret', 'proxy.url', { value: 'socks5://user:pass@127.0.0.1:1080' }),
        upsert('setting', 'theme', { value: 'dark' }),
      ],
    })

    assert.equal(summary.mutationCount, 2)
    assert.equal(summary.acceptedCount, 2)
    assert.equal(summary.conflictCount, 0)
    assert.equal(summary.fromRevision, 0)
    assert.equal(summary.toRevision, 2)

    const serialized = JSON.stringify(summary)
    assert.ok(!serialized.includes('socks5://'), '摘要日志里不能出现 Secret 值')
    assert.ok(!serialized.includes('pass'), '摘要日志里不能出现凭据片段')
  })
})

// ---------------------------------------------------------------- pull / 基线

describe('sync pull and bootstrap', { skip: skipWithoutDatabase }, () => {
  before(async () => {
    cloud = await startTestCloud()
  })

  after(async () => {
    await cloud?.close()
  })

  it('propagates deletions as tombstones', async () => {
    const user = await createSignedInUser(cloud, 'tombstone')

    const created = await push(user, [upsert('subscription', 'feed:gone', subscriptionPayload())])
    await push(user, [remove('subscription', 'feed:gone', created.results[0]!.revision!)])

    // 长期离线的设备从 0 拉，也必须看到「它已经不在了」
    const records = await pullAll(user, 100)
    const tombstone = findRecord(records, 'subscription', 'feed:gone')
    assert.ok(tombstone)
    assert.equal(tombstone.deleted, true)
    assert.equal(tombstone.payload, null)
  })

  it('pages deltas without skipping or repeating records', async () => {
    const user = await createSignedInUser(cloud, 'paging')
    const total = 12
    await push(
      user,
      Array.from({ length: total }, (_, index) =>
        upsert('setting', `key-${index}`, { value: index }),
      ),
    )

    const firstPage = await pull(user, 0, 5)
    assert.equal(firstPage.records.length, 5)
    assert.equal(firstPage.hasMore, true)
    assert.equal(firstPage.cursor, firstPage.records[4]?.revision)
    assert.equal(firstPage.currentRevision, total)

    const all = await pullAll(user, 5)
    assert.equal(all.length, total)
    assert.equal(new Set(all.map((record) => record.entityId)).size, total)

    const revisions = all.map((record) => record.revision)
    assert.deepEqual(revisions, [...revisions].sort((a, b) => a - b), 'records 按 revision 递增')
  })

  it('advances the cursor to the head on the final page', async () => {
    const user = await createSignedInUser(cloud, 'cursor')
    await push(user, [upsert('setting', 'theme', { value: 'dark' })])

    const page = await pull(user, 0, 500)
    assert.equal(page.hasMore, false)
    assert.equal(page.cursor, page.currentRevision)

    const empty = await pull(user, page.cursor, 500)
    assert.equal(empty.records.length, 0, '没有新改动时增量拉取为空')
    assert.equal(empty.cursor, page.cursor)
  })

  it('round-trips a secret through encryption at rest', async () => {
    const user = await createSignedInUser(cloud, 'secret-pull')
    const value = 'sk-round-trip-value'
    await push(user, [upsert('secret', 'translation.openai.apiKey', { value })])

    const records = await pullAll(user, 100)
    const secret = findRecord(records, 'secret', 'translation.openai.apiKey')
    assert.deepEqual(secret?.payload, { value })

    const { rows } = await cloud.pools.app.query<{ dump: string }>(
      `SELECT encode(ciphertext, 'escape') AS dump FROM user_secrets WHERE user_id = $1`,
      [user.userId],
    )
    assert.ok(rows[0])
    assert.ok(!rows[0].dump.includes(value), '库里只有密文')
  })

  it('rejects a pull limit above the protocol maximum', async () => {
    const user = await createSignedInUser(cloud, 'limit')
    const response = await cloud.app.inject({
      method: 'GET',
      url: `/api/v1/sync/pull?since=0&limit=${SYNC_LIMITS.maxPullLimit + 1}`,
      headers: authHeaders(user),
      remoteAddress: nextIp(),
    })

    assert.equal(response.statusCode, 400)
    assert.equal(response.json().code, 'VALIDATION_FAILED')
  })

  it('reports counts and secret key names without secret values', async () => {
    const user = await createSignedInUser(cloud, 'bootstrap')
    await push(user, [
      upsert('subscription', 'feed:a', subscriptionPayload()),
      upsert('subscription', 'feed:b', subscriptionPayload()),
      upsert('category', 'tech', categoryPayload()),
      upsert('setting', 'theme', { value: 'dark' }),
      upsert('secret', 'translation.openai.apiKey', { value: 'sk-never-in-bootstrap' }),
    ])

    const response = await cloud.app.inject({
      method: 'GET',
      url: '/api/v1/sync/bootstrap',
      headers: authHeaders(user),
      remoteAddress: nextIp(),
    })
    assert.equal(response.statusCode, 200)

    const body = response.json()
    assert.equal(body.protocolVersion, SYNC_PROTOCOL_VERSION)
    assert.equal(body.currentRevision, 5)
    assert.deepEqual(body.counts, { subscriptions: 2, categories: 1, settings: 1, secrets: 1 })
    assert.deepEqual(body.secretKeys, ['translation.openai.apiKey'])
    assert.ok(!response.body.includes('sk-never-in-bootstrap'), 'bootstrap 只给键名')
  })

  it('tombstones rows missing from a bootstrap replace snapshot', async () => {
    const user = await createSignedInUser(cloud, 'replace')
    await push(user, [
      upsert('subscription', 'feed:keep', subscriptionPayload()),
      upsert('subscription', 'feed:drop', subscriptionPayload()),
      upsert('setting', 'theme', { value: 'dark' }),
    ])

    const response = await cloud.app.inject({
      method: 'POST',
      url: '/api/v1/sync/bootstrap/replace',
      headers: authHeaders(user),
      remoteAddress: nextIp(),
      payload: {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        deviceId: user.deviceId,
        entities: [
          { entityType: 'subscription', entityId: 'feed:keep', payload: subscriptionPayload() },
          { entityType: 'setting', entityId: 'theme', payload: { value: 'light' } },
        ],
      },
    })

    assert.equal(response.statusCode, 200, response.body)
    const body = response.json()
    assert.equal(body.written, 2)
    assert.equal(body.tombstoned, 1)

    const records = await pullAll(user, 100)
    assert.equal(findRecord(records, 'subscription', 'feed:drop')?.deleted, true)
    assert.equal(findRecord(records, 'subscription', 'feed:keep')?.deleted, false)
    assert.deepEqual(findRecord(records, 'setting', 'theme')?.payload, { value: 'light' })

    // 物理行仍在，只是打了墓碑：别的设备才能得知删除
    const { rows } = await cloud.pools.app.query<{ total: string }>(
      'SELECT count(*)::text AS total FROM subscriptions WHERE user_id = $1',
      [user.userId],
    )
    assert.equal(rows[0]?.total, '2')
  })
})

// ------------------------------------------------------------ 设备与访问控制

describe('sync devices and access control', { skip: skipWithoutDatabase }, () => {
  before(async () => {
    cloud = await startTestCloud()
  })

  after(async () => {
    await cloud?.close()
  })

  it('registers the calling device and marks it as current', async () => {
    const user = await createSignedInUser(cloud, 'device')
    await pushRaw(user, [upsert('setting', 'theme', { value: 'dark' })], {
      deviceName: 'Pixel 7',
      platform: 'android',
      appVersion: '1.6.8',
    })

    const response = await cloud.app.inject({
      method: 'GET',
      url: '/api/v1/devices',
      headers: authHeaders(user),
      remoteAddress: nextIp(),
    })
    assert.equal(response.statusCode, 200)

    const devices = response.json().devices as Record<string, unknown>[]
    assert.equal(devices.length, 1)
    assert.equal(devices[0]?.id, user.deviceId)
    assert.equal(devices[0]?.name, 'Pixel 7')
    assert.equal(devices[0]?.platform, 'android')
    assert.equal(devices[0]?.current, true)
    assert.equal(devices[0]?.revokedAt, null)
  })

  it('stops sync for a revoked device but keeps its uploaded data', async () => {
    const user = await createSignedInUser(cloud, 'revoke')
    await push(user, [upsert('setting', 'theme', { value: 'dark' })])

    const revoke = await cloud.app.inject({
      method: 'POST',
      url: `/api/v1/devices/${user.deviceId}/revoke`,
      headers: authHeaders(user),
      remoteAddress: nextIp(),
    })
    assert.equal(revoke.statusCode, 200)

    const blocked = await pushRaw(user, [upsert('setting', 'scheme', { value: 'ink' })])
    assert.equal(blocked.statusCode, 403)
    assert.equal(blocked.json().code, 'DEVICE_REVOKED')

    // 账号数据不受影响，另一台设备照常读
    const other: SignedInUser = { ...user, deviceId: randomUUID() }
    const records = await pullAll(other, 100)
    assert.deepEqual(findRecord(records, 'setting', 'theme')?.payload, { value: 'dark' })
  })

  it('refuses a device id that already belongs to another account', async () => {
    const alice = await createSignedInUser(cloud, 'owner')
    await push(alice, [upsert('setting', 'theme', { value: 'dark' })])

    const bob = await createSignedInUser(cloud, 'intruder')
    const stolen: SignedInUser = { ...bob, deviceId: alice.deviceId }

    const response = await pushRaw(stolen, [upsert('setting', 'theme', { value: 'light' })])
    assert.equal(response.statusCode, 400)
    assert.equal(response.json().code, 'VALIDATION_FAILED')
  })

  it('never leaks another account records or conflicts', async () => {
    const alice = await createSignedInUser(cloud, 'a')
    const bob = await createSignedInUser(cloud, 'b')

    const created = await push(alice, [upsert('category', 'tech', categoryPayload())])
    const base = created.results[0]!.revision!
    await push(alice, [upsert('category', 'tech', categoryPayload({ visible: false }), base)])
    const conflicted = await push(alice, [
      upsert('category', 'tech', categoryPayload({ visible: true }), base),
    ])
    const conflictId = conflicted.conflicts[0]!.id

    const bobRecords = await pullAll(bob, 100)
    assert.equal(bobRecords.length, 0, '跨账号不可见')

    const bobConflicts = await cloud.app.inject({
      method: 'GET',
      url: '/api/v1/sync/conflicts',
      headers: authHeaders(bob),
      remoteAddress: nextIp(),
    })
    assert.deepEqual(bobConflicts.json().conflicts, [])

    const hijack = await cloud.app.inject({
      method: 'POST',
      url: `/api/v1/sync/conflicts/${conflictId}/resolve`,
      headers: authHeaders(bob),
      remoteAddress: nextIp(),
      payload: {
        protocolVersion: SYNC_PROTOCOL_VERSION,
        deviceId: bob.deviceId,
        resolution: 'accept_server',
      },
    })
    assert.equal(hijack.statusCode, 404)
    assert.equal(hijack.json().code, 'NOT_FOUND')
  })

  it('requires a session for every sync route', async () => {
    for (const [method, url] of [
      ['GET', '/api/v1/sync/bootstrap'],
      ['GET', '/api/v1/sync/pull?since=0'],
      ['POST', '/api/v1/sync/push'],
      ['GET', '/api/v1/devices'],
    ] as const) {
      const response = await cloud.app.inject({
        method,
        url,
        remoteAddress: nextIp(),
        headers: { 'content-type': 'application/json' },
        payload: method === 'POST' ? {} : undefined,
      })
      assert.equal(response.statusCode, 401, `${method} ${url}`)
      const body = response.json()
      assert.equal(body.code, 'AUTH_REQUIRED')
      assert.ok(body.requestId, '错误响应必须带 requestId')
    }
  })

  it('rejects an unsupported protocol version with an actionable code', async () => {
    const user = await createSignedInUser(cloud, 'protocol')
    const response = await cloud.app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      headers: authHeaders(user),
      remoteAddress: nextIp(),
      payload: { protocolVersion: 99, deviceId: user.deviceId, mutations: [] },
    })

    assert.equal(response.statusCode, 426)
    assert.equal(response.json().code, 'SYNC_SCHEMA_UNSUPPORTED')
    assert.ok(response.json().requestId)
  })

  it('rejects a batch larger than the protocol limit', async () => {
    const user = await createSignedInUser(cloud, 'batch')
    const mutations = Array.from({ length: SYNC_LIMITS.maxMutationsPerPush + 1 }, (_, index) =>
      upsert('setting', `key-${index}`, { value: index }),
    )

    const response = await pushRaw(user, mutations)
    assert.equal(response.statusCode, 400)
    assert.equal(response.json().code, 'VALIDATION_FAILED')
    assert.equal(await headRevision(user), 0)
  })
})

// -------------------------------------------------------------------- 冲突处理

describe('sync conflict resolution', { skip: skipWithoutDatabase }, () => {
  before(async () => {
    cloud = await startTestCloud()
  })

  after(async () => {
    await cloud?.close()
  })

  async function seedCategoryConflict(
    user: SignedInUser,
  ): Promise<{ conflictId: string; revisionBefore: number }> {
    const created = await push(user, [upsert('category', 'tech', categoryPayload())])
    const base = created.results[0]!.revision!
    await push(user, [
      upsert('category', 'tech', categoryPayload({ visible: false, label: '云端' }), base),
    ])
    const conflicted = await push(user, [
      upsert('category', 'tech', categoryPayload({ visible: true, label: '本机' }), base),
    ])

    return {
      conflictId: conflicted.conflicts[0]!.id,
      revisionBefore: conflicted.currentRevision,
    }
  }

  function resolve(
    user: SignedInUser,
    conflictId: string,
    resolution: 'accept_local' | 'accept_server',
  ): Promise<LightMyRequestResponse> {
    return cloud.app.inject({
      method: 'POST',
      url: `/api/v1/sync/conflicts/${conflictId}/resolve`,
      headers: authHeaders(user),
      remoteAddress: nextIp(),
      payload: { protocolVersion: SYNC_PROTOCOL_VERSION, deviceId: user.deviceId, resolution },
    })
  }

  async function openConflicts(user: SignedInUser): Promise<unknown[]> {
    const response = await cloud.app.inject({
      method: 'GET',
      url: '/api/v1/sync/conflicts',
      headers: authHeaders(user),
      remoteAddress: nextIp(),
    })
    assert.equal(response.statusCode, 200)
    return response.json().conflicts
  }

  it('lists an open conflict with both sides but no secret value', async () => {
    const user = await createSignedInUser(cloud, 'list')
    await seedCategoryConflict(user)
    await push(user, [upsert('secret', 'proxy.url', { value: 'socks5://127.0.0.1:1080' })])

    const conflicts = (await openConflicts(user)) as Record<string, unknown>[]
    assert.equal(conflicts.length, 1)
    assert.equal(conflicts[0]?.entityType, 'category')
    assert.equal(conflicts[0]?.resolvedAt, null)
    assert.ok(JSON.stringify(conflicts[0]?.localChange).includes('本机'))
    assert.ok(JSON.stringify(conflicts[0]?.serverState).includes('云端'))
  })

  it('applies the local side and allocates a revision for accept_local', async () => {
    const user = await createSignedInUser(cloud, 'accept-local')
    const { conflictId, revisionBefore } = await seedCategoryConflict(user)

    const response = await resolve(user, conflictId, 'accept_local')
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().resolved, true)
    assert.equal(response.json().currentRevision, revisionBefore + 1)

    const records = await pullAll(user, 100)
    const category = findRecord(records, 'category', 'tech')
    assert.equal((category?.payload as { label?: string })?.label, '本机')
    assert.deepEqual(await openConflicts(user), [])
  })

  it('keeps the server state and allocates nothing for accept_server', async () => {
    const user = await createSignedInUser(cloud, 'accept-server')
    const { conflictId, revisionBefore } = await seedCategoryConflict(user)

    const response = await resolve(user, conflictId, 'accept_server')
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json().currentRevision, revisionBefore, 'accept_server 不产生新版本')

    const records = await pullAll(user, 100)
    const category = findRecord(records, 'category', 'tech')
    assert.equal((category?.payload as { label?: string })?.label, '云端')
    assert.deepEqual(await openConflicts(user), [])
  })

  it('is idempotent when the same conflict is resolved twice', async () => {
    const user = await createSignedInUser(cloud, 'twice')
    const { conflictId } = await seedCategoryConflict(user)

    const first = await resolve(user, conflictId, 'accept_local')
    assert.equal(first.statusCode, 200)
    const second = await resolve(user, conflictId, 'accept_local')

    assert.equal(second.statusCode, 200)
    assert.equal(second.json().currentRevision, first.json().currentRevision)
  })

  it('keeps unrelated entities syncing while a conflict is open', async () => {
    const user = await createSignedInUser(cloud, 'unblocked')
    await seedCategoryConflict(user)

    const result = await push(user, [
      upsert('subscription', 'feed:unrelated', subscriptionPayload()),
    ])
    assert.equal(result.results[0]?.status, 'accepted')

    const records = await pullAll(user, 100)
    assert.equal(findRecord(records, 'subscription', 'feed:unrelated')?.deleted, false)
  })

  it('returns NOT_FOUND for an unknown conflict id', async () => {
    const user = await createSignedInUser(cloud, 'missing')
    const response = await resolve(user, randomUUID(), 'accept_server')

    assert.equal(response.statusCode, 404)
    assert.equal(response.json().code, 'NOT_FOUND')
    assert.ok(response.json().requestId)
  })
})
