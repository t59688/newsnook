/**
 * 冲突分类：纯函数，不碰数据库，方便单测穷举。
 *
 * 原则（与设计 §9 一致）：能自动收敛的都自动收敛，只有可能导致内容消失或
 * 归属明显变化的结构性分歧才打扰用户。
 */

import type { SyncConflictReason, SyncEntityType, SyncMutation } from '@newsnook/contracts'

export interface ExistingEntityState {
  revision: number
  deleted: boolean
  /** 云端当前内容；用来识别「陈旧但内容一致」的伪冲突。Secret 永远为 null */
  payload?: unknown
}

export type MutationDecision =
  | { kind: 'accept' }
  | { kind: 'noop' }
  | { kind: 'conflict'; reason: SyncConflictReason }

/**
 * 客户端提交时依据的版本是否已经落后于服务端当前状态。
 * `baseRevision === null` 表示客户端认为这是本地新建的实体。
 */
export function isStale(
  existing: ExistingEntityState | null,
  baseRevision: number | null,
): boolean {
  if (!existing) return false
  return existing.revision > (baseRevision ?? 0)
}

/**
 * 顺序无关的深比较：payload 从 jsonb 与 HTTP body 两条路进来，
 * 键序不同不代表内容不同，不能直接 `JSON.stringify` 对比。
 */
export function samePayload(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (left === null || right === null) return false
  if (typeof left !== 'object' || typeof right !== 'object') return false

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false
    if (left.length !== right.length) return false
    return left.every((item, index) => samePayload(item, right[index]))
  }

  const leftEntries = Object.entries(left as Record<string, unknown>).filter(
    ([, value]) => value !== undefined,
  )
  const rightRecord = right as Record<string, unknown>
  const rightKeys = Object.keys(rightRecord).filter((key) => rightRecord[key] !== undefined)
  if (leftEntries.length !== rightKeys.length) return false

  return leftEntries.every(
    ([key, value]) =>
      Object.prototype.hasOwnProperty.call(rightRecord, key) &&
      samePayload(value, rightRecord[key]),
  )
}

export function classifyMutation(
  mutation: Pick<SyncMutation, 'entityType' | 'operation' | 'baseRevision' | 'payload'>,
  existing: ExistingEntityState | null,
): MutationDecision {
  const { entityType, operation } = mutation

  if (!existing) {
    // 删除一个服务端从未见过的实体：无事发生，但仍要写幂等记录
    return operation === 'delete' ? { kind: 'noop' } : { kind: 'accept' }
  }

  if (operation === 'delete' && existing.deleted) return { kind: 'noop' }

  if (!isStale(existing, mutation.baseRevision)) return { kind: 'accept' }

  return classifyStale(entityType, operation, existing, mutation.payload)
}

function classifyStale(
  entityType: SyncEntityType,
  operation: 'upsert' | 'delete',
  existing: ExistingEntityState,
  payload: unknown,
): MutationDecision {
  switch (entityType) {
    // 普通设置与 Secret：后提交的 mutation 生效，服务端提交顺序即真相
    case 'setting':
    case 'secret':
      return { kind: 'accept' }

    case 'subscription':
      if (operation === 'upsert') {
        // 另一台设备已经删掉了这条订阅，这边还在改它：内容会「复活」，交给用户
        return existing.deleted
          ? { kind: 'conflict', reason: 'update_vs_delete' }
          : { kind: 'accept' }
      }
      // 这边要删，别处刚改过：删除会让别人的修改消失
      return { kind: 'conflict', reason: 'delete_vs_update' }

    case 'category':
      if (existing.deleted) {
        return operation === 'upsert'
          ? { kind: 'conflict', reason: 'update_vs_delete' }
          : { kind: 'noop' }
      }
      /**
       * 两台设备各自基于默认分类做同一件事（典型场景：都是全新安装后合并），
       * 提交的内容与云端逐字相同。这种「陈旧但无分歧」的 mutation 只是回声，
       * 判成冲突会一次刷出上百条要用户裁决的伪冲突。
       */
      if (operation === 'upsert' && samePayload(existing.payload, payload)) {
        return { kind: 'noop' }
      }
      // 剩下的分类分歧会改变订阅归属，一律显式处理
      return { kind: 'conflict', reason: 'category_stale_mutation' }
  }
}

/**
 * 冲突快照里能放什么：Secret 的值永远不进快照，只留键名与操作。
 * 其余实体保留 payload，供「使用本机 / 使用云端」两个动作展示差异。
 */
export function conflictSnapshot(
  entityType: SyncEntityType,
  payload: unknown,
): unknown {
  if (entityType === 'secret') return { redacted: true }
  return payload ?? null
}
