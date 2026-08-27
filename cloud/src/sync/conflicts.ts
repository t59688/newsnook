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

export function classifyMutation(
  mutation: Pick<SyncMutation, 'entityType' | 'operation' | 'baseRevision'>,
  existing: ExistingEntityState | null,
): MutationDecision {
  const { entityType, operation } = mutation

  if (!existing) {
    // 删除一个服务端从未见过的实体：无事发生，但仍要写幂等记录
    return operation === 'delete' ? { kind: 'noop' } : { kind: 'accept' }
  }

  if (operation === 'delete' && existing.deleted) return { kind: 'noop' }

  if (!isStale(existing, mutation.baseRevision)) return { kind: 'accept' }

  return classifyStale(entityType, operation, existing)
}

function classifyStale(
  entityType: SyncEntityType,
  operation: 'upsert' | 'delete',
  existing: ExistingEntityState,
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
      // 分类结构冲突会改变订阅归属，一律显式处理
      return existing.deleted && operation === 'upsert'
        ? { kind: 'conflict', reason: 'update_vs_delete' }
        : { kind: 'conflict', reason: 'category_stale_mutation' }
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
