/**
 * 客户端投影与对账：本地状态 → 同步实体 → 本地状态的往返一致性、
 * Secret 与普通设置的分离、设备本地设置不上传，以及崩溃后重新对账能补回改动。
 * 用法：npx tsx scripts/sync-projection.test.ts
 */
import assert from 'node:assert/strict'

import type { SyncRecord } from '@newsnook/contracts'

import { canonicalJson, fingerprintOf, sha256Hex } from '../src/features/sync/fingerprint'
import { randomUuid } from '../src/features/sync/ids'
import { applyRemoteRecords, type LocalRuntimeState } from '../src/features/sync/merge'
import {
  PROXY_URL_SECRET_KEY,
  SETTING_KEYS,
  normalizeSubscriptionUrl,
  projectLocalState,
  translationSecretKey,
} from '../src/features/sync/projection'
import { materializeMutation, reconcileProjection } from '../src/features/sync/reconcile'
import {
  createInitialSyncState,
  normalizeSyncState,
  redactForPersistence,
} from '../src/features/sync/state'
import { entityKey, type LocalSyncState, type OutboxEntry } from '../src/features/sync/types'
import { DEFAULT_PREFERENCES, normalizePreferences } from '../src/sources/preferences'
import { buildFreshInstallPresetsState } from '../src/sources/presets'
import { SOURCES } from '../src/sources/registry'

console.log('Testing cloud sync projection and reconciliation...')

const BUILTIN_ENABLED = SOURCES.filter((source) => source.enabled).map((source) => source.id)

function baseState(): LocalRuntimeState {
  return {
    prefs: normalizePreferences(DEFAULT_PREFERENCES),
    enabledIds: [...BUILTIN_ENABLED],
    presets: buildFreshInstallPresetsState(),
  }
}

function syncState(patch: Partial<LocalSyncState> = {}): LocalSyncState {
  return { ...createInitialSyncState('11111111-2222-4333-8444-555555555555'), ...patch }
}

/** 把一份投影当作「服务端已确认」，供对账测试用 */
function shadowFromProjection(state: LocalRuntimeState, startRevision = 1): LocalSyncState {
  const projection = projectLocalState(state)
  const shadow: LocalSyncState['shadow'] = {}
  let revision = startRevision
  for (const [key, entity] of Object.entries(projection)) {
    shadow[key] = { revision, fingerprint: entity.fingerprint, deleted: false }
    revision += 1
  }
  return syncState({ shadow, cursor: revision - 1 })
}

function recordsFromProjection(state: LocalRuntimeState): SyncRecord[] {
  return Object.values(projectLocalState(state)).map((entity, index) => ({
    entityType: entity.entityType,
    entityId: entity.entityId,
    revision: index + 1,
    deleted: false,
    updatedAt: 0,
    payload: entity.payload,
  }))
}

// ------------------------------------------------------------------ 指纹基础

{
  // 已知向量：实现正确性不能只靠自洽
  assert.equal(
    sha256Hex(''),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  )
  assert.equal(
    sha256Hex('abc'),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
  assert.equal(
    sha256Hex('有所闻'),
    sha256Hex('有所闻'),
  )
  assert.equal(sha256Hex('a'.repeat(1000)).length, 64)

  // 键序不同但内容相同的对象必须得到同一指纹，否则每台设备都会重推一遍
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}')
  assert.equal(fingerprintOf({ a: 1, b: [1, 2] }), fingerprintOf({ b: [1, 2], a: 1 }))
  assert.notEqual(fingerprintOf({ a: 1 }), fingerprintOf({ a: 2 }))
  assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}')
}

{
  const uuid = randomUuid()
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.notEqual(randomUuid(), randomUuid())
}

// -------------------------------------------------------------- 投影范围契约

{
  const state = baseState()
  const projection = projectLocalState(state)
  const ids = Object.keys(projection)

  assert.ok(ids.length > 0)
  assert.ok(ids.every((key) => key.includes(':')))

  // 设备本地设置永远不上传
  for (const field of ['einkMode', 'wifiOnlyAutoLoadMedia', 'prestore']) {
    assert.equal(projection[entityKey('setting', field)], undefined, `${field} 不应进入投影`)
  }

  // 阅读侧数据完全不在同步范围内
  for (const field of ['later', 'read', 'reading-pos', 'history']) {
    assert.equal(projection[entityKey('setting', field)], undefined)
  }

  // 启用的内置源都成为订阅，且 id 直接复用注册表 id
  const subscriptionIds = Object.values(projection)
    .filter((entity) => entity.entityType === 'subscription')
    .map((entity) => entity.entityId)
  assert.deepEqual([...subscriptionIds].sort(), [...BUILTIN_ENABLED].sort())

  // 预设整体作为一个 setting 实体
  assert.ok(projection[entityKey('setting', SETTING_KEYS.presets)])
}

{
  // 同一份状态投影两次必须完全一致（rank 稳定，没有时间戳/随机数渗入）
  const state = baseState()
  assert.equal(canonicalJson(projectLocalState(state)), canonicalJson(projectLocalState(state)))
}

// ------------------------------------------------------------- Secret 分离

{
  const state = baseState()
  state.prefs.translation.cloud.openai = {
    ...state.prefs.translation.cloud.openai,
    apiKey: 'sk-openai-secret',
    model: 'gpt-4o-mini',
  }
  state.prefs.proxy = { ...state.prefs.proxy, proxyUrl: 'socks5://127.0.0.1:1080' }

  const projection = projectLocalState(state)

  const openaiSecret = projection[entityKey('secret', translationSecretKey('openai'))]
  assert.ok(openaiSecret)
  assert.deepEqual(openaiSecret.payload, { value: 'sk-openai-secret' })

  const proxySecret = projection[entityKey('secret', PROXY_URL_SECRET_KEY)]
  assert.deepEqual(proxySecret?.payload, { value: 'socks5://127.0.0.1:1080' })

  // 普通设置里绝不能残留密钥
  const translationSetting = projection[entityKey('setting', SETTING_KEYS.translation)]
  const serializedSetting = canonicalJson(translationSetting?.payload)
  assert.ok(!serializedSetting.includes('sk-openai-secret'))
  assert.ok(serializedSetting.includes('gpt-4o-mini'), '非密钥字段照常同步')

  const proxySetting = projection[entityKey('setting', SETTING_KEYS.proxy)]
  assert.ok(!canonicalJson(proxySetting?.payload).includes('127.0.0.1'))

  // 清空密钥后该 secret 实体直接消失，对账会转成 delete
  const cleared = baseState()
  assert.equal(
    projectLocalState(cleared)[entityKey('secret', translationSecretKey('openai'))],
    undefined,
  )
}

// ---------------------------------------------------------------- 往返一致性

{
  const local = baseState()
  local.prefs = normalizePreferences({
    ...local.prefs,
    customSources: [
      {
        id: 'custom:example',
        name: '示例订阅',
        label: '示例',
        group: 'custom',
        kind: 'feed',
        url: 'https://example.com/feed.xml/',
        siteUrl: 'https://example.com',
        enabled: true,
        isCustom: true,
        createdAt: 1_700_000_000_000,
      },
    ],
    customCategories: [
      {
        id: 'custom-cat',
        label: '我的分类',
        short: '我的',
        caption: '',
        sourceIds: ['custom:example'],
        isCustom: true,
      },
    ],
    categoryOrder: ['tech', 'custom-cat', 'mix'],
    hiddenCategoryIds: ['game'],
    categorySources: { tech: ['custom:example'] },
    theme: 'dark',
    typography: { ...local.prefs.typography, fontScale: 1.1 },
  })
  local.enabledIds = [...BUILTIN_ENABLED, 'custom:example']

  // 干净设备从零收下这份状态
  const fresh = baseState()
  const restored = applyRemoteRecords(fresh, recordsFromProjection(local))

  assert.equal(restored.prefs.theme, 'dark')
  assert.equal(restored.prefs.typography.fontScale, 1.1)

  const custom = restored.prefs.customSources?.find((source) => source.id === 'custom:example')
  assert.ok(custom, '自建源必须完整还原')
  assert.equal(custom.name, '示例订阅')
  assert.equal(custom.url, 'https://example.com/feed.xml/')
  assert.equal(custom.siteUrl, 'https://example.com')
  assert.equal(custom.createdAt, 1_700_000_000_000)

  const category = restored.prefs.customCategories?.find((entry) => entry.id === 'custom-cat')
  assert.ok(category)
  assert.equal(category.label, '我的分类')
  assert.deepEqual(category.sourceIds, ['custom:example'])

  assert.ok(restored.enabledIds.includes('custom:example'))
  assert.deepEqual(restored.prefs.categorySources.tech, ['custom:example'])
  assert.ok(restored.prefs.hiddenCategoryIds.includes('game'))
  assert.equal(restored.prefs.categoryOrder[0], 'tech')
  assert.equal(restored.prefs.categoryOrder[1], 'custom-cat')

  // 再投影一次应当收敛：往返不产生新的差异
  const before = projectLocalState(local)
  const after = projectLocalState(restored)
  for (const key of Object.keys(before)) {
    assert.equal(after[key]?.fingerprint, before[key]?.fingerprint, `${key} 往返后指纹应一致`)
  }
}

{
  // 设备本地设置在接收远端数据后必须原样保留
  const device = baseState()
  device.prefs = normalizePreferences({
    ...device.prefs,
    einkMode: true,
    wifiOnlyAutoLoadMedia: true,
    prestore: { enabled: true, perSourceLimit: 20 },
  })

  const remote = baseState()
  remote.prefs = normalizePreferences({ ...remote.prefs, theme: 'dark' })

  const merged = applyRemoteRecords(device, recordsFromProjection(remote))
  assert.equal(merged.prefs.theme, 'dark', '远端设置照常生效')
  assert.equal(merged.prefs.einkMode, true, '墨水屏是设备本地设置')
  assert.equal(merged.prefs.wifiOnlyAutoLoadMedia, true)
  assert.equal(merged.prefs.prestore.perSourceLimit, 20)
}

{
  // tombstone：远端删除的自建源在本机也要消失
  const withCustom = baseState()
  withCustom.prefs = normalizePreferences({
    ...withCustom.prefs,
    customSources: [
      {
        id: 'custom:gone',
        name: '将被删除',
        label: '删',
        group: 'custom',
        kind: 'feed',
        url: 'https://gone.example/feed',
        enabled: true,
        isCustom: true,
        createdAt: 1,
      },
    ],
  })
  withCustom.enabledIds = [...BUILTIN_ENABLED, 'custom:gone']

  const after = applyRemoteRecords(withCustom, [
    {
      entityType: 'subscription',
      entityId: 'custom:gone',
      revision: 99,
      deleted: true,
      updatedAt: 0,
      payload: null,
    },
  ])

  assert.equal(after.prefs.customSources?.length, 0)
  assert.ok(!after.enabledIds.includes('custom:gone'))
}

// -------------------------------------------------------------------- 对账

{
  const local = baseState()
  const state = shadowFromProjection(local)

  // 完全同步的状态不应产生任何 mutation
  assert.deepEqual(reconcileProjection(projectLocalState(local), state).added, [])
}

{
  // 只改设备本地设置：一条 mutation 都不该产生
  const local = baseState()
  const state = shadowFromProjection(local)

  const localOnly: LocalRuntimeState = {
    ...local,
    prefs: normalizePreferences({
      ...local.prefs,
      einkMode: true,
      wifiOnlyAutoLoadMedia: true,
      prestore: { enabled: true, perSourceLimit: 50 },
    }),
  }

  assert.deepEqual(
    reconcileProjection(projectLocalState(localOnly), state).added,
    [],
    '设备本地设置变化不应触发同步',
  )
}

{
  // 崩溃场景：本地已经改了配置，但 Outbox 还没来得及落盘
  const local = baseState()
  const state = shadowFromProjection(local)

  const changed: LocalRuntimeState = {
    ...local,
    prefs: normalizePreferences({ ...local.prefs, theme: 'dark' }),
  }

  const { added, outbox } = reconcileProjection(projectLocalState(changed), state)
  assert.equal(added.length, 1)
  assert.equal(added[0]?.entityType, 'setting')
  assert.equal(added[0]?.entityId, SETTING_KEYS.theme)
  assert.equal(added[0]?.operation, 'upsert')
  assert.equal(
    added[0]?.baseRevision,
    state.shadow[entityKey('setting', SETTING_KEYS.theme)]?.revision,
  )
  assert.equal(outbox.length, 1)

  // 已经排进 Outbox 后再对账不能重复生成
  const again = reconcileProjection(projectLocalState(changed), { ...state, outbox })
  assert.deepEqual(again.added, [])
}

{
  // 停用一个内置源 = 取消订阅 → delete mutation
  const local = baseState()
  const state = shadowFromProjection(local)
  const removedId = BUILTIN_ENABLED[0]!

  const disabled: LocalRuntimeState = {
    ...local,
    enabledIds: local.enabledIds.filter((id) => id !== removedId),
  }

  const { added } = reconcileProjection(projectLocalState(disabled), state)
  const deletion = added.find((entry) => entry.operation === 'delete')
  assert.ok(deletion, '停用内置源应生成 delete')
  assert.equal(deletion.entityType, 'subscription')
  assert.equal(deletion.entityId, removedId)
  assert.equal(
    deletion.baseRevision,
    state.shadow[entityKey('subscription', removedId)]?.revision,
  )
}

{
  // mutation 记住的是它当时代表的那份内容，不是「最新 UI 状态」
  const local = baseState()
  const state = shadowFromProjection(local)

  const first: LocalRuntimeState = {
    ...local,
    prefs: normalizePreferences({ ...local.prefs, theme: 'dark' }),
  }
  const firstPass = reconcileProjection(projectLocalState(first), state)
  const darkFingerprint = firstPass.added[0]!.fingerprint

  const second: LocalRuntimeState = {
    ...local,
    prefs: normalizePreferences({ ...local.prefs, theme: 'light' }),
  }
  const secondPass = reconcileProjection(projectLocalState(second), {
    ...state,
    outbox: firstPass.outbox,
  })

  assert.equal(secondPass.added.length, 1, '内容又变了，应追加一笔新的 mutation')
  assert.notEqual(secondPass.added[0]?.fingerprint, darkFingerprint)
  assert.equal(secondPass.outbox.length, 2, '在途 mutation 不被就地改写')
}

// ------------------------------------------------- Secret 不落盘 / 现取现发

{
  const local = baseState()
  local.prefs.translation.cloud.deepl = {
    ...local.prefs.translation.cloud.deepl,
    apiKey: 'dl-secret-value',
  }

  const projection = projectLocalState(local)
  const { added } = reconcileProjection(projection, syncState())
  const secretEntry = added.find((entry) => entry.entityType === 'secret')
  assert.ok(secretEntry)
  assert.equal(secretEntry.payload, null, 'Outbox 里不带 Secret 明文')

  const mutation = materializeMutation(secretEntry, projection)
  assert.deepEqual(mutation?.payload, { value: 'dl-secret-value' }, 'push 前才从投影现取')
  assert.equal(
    (mutation as Record<string, unknown>).fingerprint,
    undefined,
    'fingerprint 是本地字段，不发给服务端',
  )

  // 本机的值已经变了：这笔旧 mutation 必须作废，不能把旧密钥推上云
  const rotated = baseState()
  rotated.prefs.translation.cloud.deepl = {
    ...rotated.prefs.translation.cloud.deepl,
    apiKey: 'dl-rotated-value',
  }
  assert.equal(materializeMutation(secretEntry, projectLocalState(rotated)), null)
}

{
  // 持久化前必须再擦一遍 Secret
  const entry: OutboxEntry = {
    mutationId: randomUuid(),
    entityType: 'secret',
    entityId: translationSecretKey('openai'),
    operation: 'upsert',
    baseRevision: null,
    payload: { value: 'sk-should-never-persist' },
    fingerprint: 'abc',
  }
  const persisted = redactForPersistence(syncState({ outbox: [entry] }))
  assert.equal(persisted.outbox[0]?.payload, null)
  assert.ok(!JSON.stringify(persisted).includes('sk-should-never-persist'))

  // 即便旧版本或篡改过的数据里带了明文，读回时也要抹掉
  const reloaded = normalizeSyncState({
    deviceId: '11111111-2222-4333-8444-555555555555',
    cursor: 3,
    shadow: { 'setting:theme': { revision: 3, fingerprint: 'f', deleted: false } },
    outbox: [entry],
    firstSyncCompleted: true,
  })
  assert.equal(reloaded.outbox[0]?.payload, null)
  assert.equal(reloaded.cursor, 3)
  assert.equal(reloaded.firstSyncCompleted, true)
}

{
  // 损坏数据不能让同步整个瘫掉
  const recovered = normalizeSyncState({
    deviceId: 42,
    cursor: -5,
    shadow: { bad: null, good: { revision: 2, fingerprint: 'f' } },
    outbox: [null, { mutationId: 'm', entityType: 'nope', entityId: 'x', operation: 'upsert' }],
  })
  assert.equal(typeof recovered.deviceId, 'string')
  assert.equal(recovered.cursor, 0)
  assert.deepEqual(Object.keys(recovered.shadow), ['good'])
  assert.deepEqual(recovered.outbox, [])
}

// ------------------------------------------------------------------- 杂项

{
  assert.equal(normalizeSubscriptionUrl('https://Example.com/feed/'), 'https://example.com/feed')
  assert.equal(normalizeSubscriptionUrl(' https://example.com/a?b=1 '), 'https://example.com/a?b=1')
  assert.equal(normalizeSubscriptionUrl('not a url/'), 'not a url')
}

console.log('All cloud sync projection tests passed.')
