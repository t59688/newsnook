/**
 * 投影对账：比较「当前投影」与「服务端已确认的 shadow」，补齐缺失的 mutation。
 *
 * 这是崩溃安全的关键。写本地配置与写 Outbox 不是一个原子操作，
 * 如果 App 在两者之间被杀掉，改动就只存在于 Preferences 里。
 * 冷启动重新对账一次即可把它找回来，无需事务日志。
 */

import type { SyncMutation } from '@newsnook/contracts'

import { randomUuid } from './ids'
import {
  DELETED_FINGERPRINT,
  entityKey,
  parseEntityKey,
  type LocalProjection,
  type LocalSyncState,
  type OutboxEntry,
  type SyncEntityKey,
} from './types'

/** 同一实体只看最后一笔待发 mutation：它代表客户端最终想要的状态 */
function lastPendingByKey(outbox: OutboxEntry[]): Map<SyncEntityKey, OutboxEntry> {
  const pending = new Map<SyncEntityKey, OutboxEntry>()
  for (const entry of outbox) {
    pending.set(entityKey(entry.entityType, entry.entityId), entry)
  }
  return pending
}

/**
 * 客户端「认为」服务端最终会处于的指纹：
 * 有待发 mutation 就是那笔 mutation 的指纹，否则是 shadow 里已确认的指纹。
 */
function intendedFingerprint(
  key: SyncEntityKey,
  state: LocalSyncState,
  pending: Map<SyncEntityKey, OutboxEntry>,
): string | null {
  const entry = pending.get(key)
  if (entry) return entry.fingerprint
  const shadow = state.shadow[key]
  if (!shadow || shadow.deleted) return null
  return shadow.fingerprint
}

export interface ReconcileResult {
  /** 需要追加到 Outbox 的新 mutation（已按实体类型稳定排序） */
  added: OutboxEntry[]
  outbox: OutboxEntry[]
}

/**
 * 生成把服务端推到当前投影所需的最小 mutation 集合。
 * 幂等：投影与 shadow/outbox 已经一致时返回空集，不产生任何噪声。
 *
 * 已经开出待裁决冲突的实体整个跳过：那处分歧的裁决权在用户手上，
 * 在此之前每轮都重推一遍只会把一处分歧刷成成排的冲突。
 */
export function reconcileProjection(
  projection: LocalProjection,
  state: LocalSyncState,
): ReconcileResult {
  const pending = lastPendingByKey(state.outbox)
  const added: OutboxEntry[] = []

  const keys = Object.keys(projection).sort()
  for (const key of keys) {
    const entity = projection[key]!
    if (state.conflicted[key]) continue
    if (intendedFingerprint(key, state, pending) === entity.fingerprint) continue

    added.push({
      mutationId: randomUuid(),
      entityType: entity.entityType,
      entityId: entity.entityId,
      operation: 'upsert',
      baseRevision: state.shadow[key]?.revision ?? null,
      // Secret 明文不进 Outbox；push 前用 fingerprint 对上投影再现取
      payload: entity.entityType === 'secret' ? null : entity.payload,
      fingerprint: entity.fingerprint,
    })
  }

  for (const key of Object.keys(state.shadow).sort()) {
    const shadow = state.shadow[key]!
    if (shadow.deleted) continue
    if (state.conflicted[key]) continue
    if (projection[key]) continue
    if (pending.get(key)?.operation === 'delete') continue

    const { entityType, entityId } = parseEntityKey(key)
    added.push({
      mutationId: randomUuid(),
      entityType,
      entityId,
      operation: 'delete',
      baseRevision: shadow.revision,
      payload: null,
      fingerprint: DELETED_FINGERPRINT,
    })
  }

  return { added, outbox: added.length ? [...state.outbox, ...added] : state.outbox }
}

/**
 * 把 Outbox 条目还原成可发送的 mutation。
 *
 * Secret 的值只在这一刻从内存投影里取。如果本机的值已经和这笔 mutation
 * 代表的内容不一致，就返回 null 让它作废——对账会为新值生成新的 mutation，
 * 绝不把「用户已经改掉的旧密钥」再推上云。
 */
export function materializeMutation(
  entry: OutboxEntry,
  projection: LocalProjection,
): SyncMutation | null {
  const { fingerprint: _fingerprint, ...mutation } = entry
  if (entry.entityType !== 'secret' || entry.operation === 'delete') return mutation

  const projected = projection[entityKey(entry.entityType, entry.entityId)]
  if (!projected || projected.fingerprint !== entry.fingerprint) return null
  return { ...mutation, payload: projected.payload }
}

export function materializeBatch(
  entries: OutboxEntry[],
  projection: LocalProjection,
): { mutations: SyncMutation[]; dropped: OutboxEntry[] } {
  const mutations: SyncMutation[] = []
  const dropped: OutboxEntry[] = []

  for (const entry of entries) {
    const mutation = materializeMutation(entry, projection)
    if (mutation) mutations.push(mutation)
    else dropped.push(entry)
  }

  return { mutations, dropped }
}
