/**
 * 冲突裁决的表达层（纯函数，便于直接断言）。
 *
 * 冲突可能一次出现几十处，UI 遵循「摘要 → 按类分组 → 逐项裁决 → 一次应用」：
 * 这里负责把协议里的 SyncConflict 变成中文标题、双边描述、分组摘要与批量决定，
 * 组件只做渲染与点按，不自己解析 payload。Secret 的值永远不出现在任何输出里。
 */

import type { SyncConflict, SyncConflictResolution, SyncEntityType } from '@newsnook/contracts'
import { SYNC_ENTITY_TYPES } from '@newsnook/contracts/protocol'

import { CATEGORIES } from '../../sources/categories'
import { findSource } from '../../sources/registry'

export const CONFLICT_ENTITY_LABEL: Record<SyncEntityType, string> = {
  subscription: '订阅源',
  category: '分类',
  setting: '设置',
  secret: '密钥',
}

const REASON_TEXT: Record<string, string> = {
  delete_vs_update: '一台设备删除了它，另一台设备同时改了它',
  update_vs_delete: '这台设备改了它，云端已经把它删掉',
  stale_structural_update: '两台设备改了同一处，改动无法自动合并',
  category_stale_mutation: '这个分类在另一台设备上已被改动',
}

export function conflictReasonText(reason: string): string {
  return REASON_TEXT[reason] ?? '两处改动无法自动合并'
}

/** 跨设备设置键 → 用户能看懂的名字（键名见 features/sync/projection.ts） */
const SETTING_LABEL: Record<string, string> = {
  typography: '排版设置',
  theme: '明暗主题',
  scheme: '配色方案',
  customScheme: '自定义配色',
  translation: '翻译设置',
  proxy: '代理设置',
  autoRefreshOnCategorySwitch: '切换分类自动刷新',
  recommendEnabled: '本地推荐',
  presets: '场景预设',
}

const SECRET_LABEL: Record<string, string> = {
  'proxy.url': '代理地址',
  'translation.google.apiKey': 'Google 翻译密钥',
  'translation.azure.apiKey': 'Azure 翻译密钥',
  'translation.deepl.apiKey': 'DeepL 翻译密钥',
  'translation.deeplx.apiKey': 'DeepLX 翻译密钥',
  'translation.openai.apiKey': 'OpenAI 翻译密钥',
}

interface LocalChangeSnapshot {
  operation?: 'upsert' | 'delete'
  payload?: unknown
}

interface ServerStateSnapshot {
  deleted?: boolean
  payload?: unknown
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function localChangeOf(conflict: SyncConflict): LocalChangeSnapshot {
  return asRecord(conflict.localChange) ?? {}
}

function serverStateOf(conflict: SyncConflict): ServerStateSnapshot {
  return asRecord(conflict.serverState) ?? {}
}

function payloadName(payload: unknown): string | null {
  const record = asRecord(payload)
  if (!record) return null
  for (const key of ['name', 'label'] as const) {
    const value = record[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/**
 * 冲突条目的标题：优先用快照里的名字，退回注册表，最后才露 entityId。
 * Secret 只显示键名对应的用途，值在任何一层都不出现。
 */
export function conflictTitle(conflict: SyncConflict): string {
  const { entityType, entityId } = conflict
  if (entityType === 'secret') return SECRET_LABEL[entityId] ?? entityId
  if (entityType === 'setting') return SETTING_LABEL[entityId] ?? entityId

  const fromSnapshot =
    payloadName(localChangeOf(conflict).payload) ?? payloadName(serverStateOf(conflict).payload)
  if (fromSnapshot) return fromSnapshot

  if (entityType === 'subscription') return findSource(entityId)?.name ?? entityId
  return CATEGORIES.find((category) => category.id === entityId)?.label ?? entityId
}

export interface ConflictSideView {
  /** 这一侧到底是什么：改动 / 删除 / 当前内容 */
  action: string
  /** payload 的简短中文摘要；没有可说的就是 null */
  detail: string | null
}

function payloadDetail(entityType: SyncEntityType, payload: unknown): string | null {
  if (entityType === 'secret') return '密钥内容不会展示'
  const record = asRecord(payload)
  if (!record) return null

  if (entityType === 'subscription') {
    const parts: string[] = []
    if (typeof record.enabled === 'boolean') parts.push(record.enabled ? '订阅中' : '已停用')
    if (record.kind === 'custom') parts.push('自建源')
    return parts.length ? parts.join(' · ') : null
  }

  if (entityType === 'category') {
    const parts: string[] = []
    if (typeof record.visible === 'boolean') parts.push(record.visible ? '显示中' : '已隐藏')
    if (Array.isArray(record.sourceIds)) parts.push(`${record.sourceIds.length} 个信源`)
    else if (record.sourceIds === null) parts.push('默认信源')
    return parts.length ? parts.join(' · ') : null
  }

  return null
}

/** 双边描述：`local` 是这台设备没推上去的改动，`server` 是云端当前状态 */
export function describeConflictSides(conflict: SyncConflict): {
  local: ConflictSideView
  server: ConflictSideView
} {
  const local = localChangeOf(conflict)
  const server = serverStateOf(conflict)

  return {
    local: {
      action: local.operation === 'delete' ? '在这台设备上已删除' : '保留这台设备的改动',
      detail:
        local.operation === 'delete' ? null : payloadDetail(conflict.entityType, local.payload),
    },
    server: {
      action: server.deleted ? '在云端已删除' : '保留云端的版本',
      detail: server.deleted ? null : payloadDetail(conflict.entityType, server.payload),
    },
  }
}

// ------------------------------------------------------------- 摘要与分组

export interface ConflictSummary {
  total: number
  /** 按协议实体类型顺序，只含实际出现的类型 */
  groups: Array<{ entityType: SyncEntityType; count: number }>
}

export function summarizeConflicts(conflicts: SyncConflict[]): ConflictSummary {
  const counts = new Map<SyncEntityType, number>()
  for (const conflict of conflicts) {
    counts.set(conflict.entityType, (counts.get(conflict.entityType) ?? 0) + 1)
  }
  return {
    total: conflicts.length,
    groups: SYNC_ENTITY_TYPES.filter((entityType) => counts.has(entityType)).map((entityType) => ({
      entityType,
      count: counts.get(entityType)!,
    })),
  }
}

export type ConflictScope = SyncEntityType | 'all'

export function filterConflicts(conflicts: SyncConflict[], scope: ConflictScope): SyncConflict[] {
  if (scope === 'all') return conflicts
  return conflicts.filter((conflict) => conflict.entityType === scope)
}

// ------------------------------------------------------------- 决定的暂存

/** conflict.id → 用户已选的那一边；应用前只存在内存里，关掉面板即作废 */
export type ConflictDecisions = Readonly<Record<string, SyncConflictResolution>>

export function stageDecision(
  decisions: ConflictDecisions,
  conflictId: string,
  resolution: SyncConflictResolution | null,
): ConflictDecisions {
  if (resolution === null) {
    if (!(conflictId in decisions)) return decisions
    const next = { ...decisions }
    delete next[conflictId]
    return next
  }
  return { ...decisions, [conflictId]: resolution }
}

/** 批量决定：整组（或整类）改成同一边；范围外已做的决定原样保留 */
export function stageBulkDecision(
  decisions: ConflictDecisions,
  conflicts: SyncConflict[],
  resolution: SyncConflictResolution,
  scope: ConflictScope = 'all',
): ConflictDecisions {
  const next = { ...decisions }
  for (const conflict of filterConflicts(conflicts, scope)) {
    next[conflict.id] = resolution
  }
  return next
}

/** 只统计还挂在队列里的冲突：已经在服务端裁决掉的过期决定不计入 */
export function decidedCount(conflicts: SyncConflict[], decisions: ConflictDecisions): number {
  let count = 0
  for (const conflict of conflicts) {
    if (conflict.id in decisions) count += 1
  }
  return count
}

/** 面板「应用」时提交的载荷：按当前队列顺序，只带仍然存在的冲突 */
export function materializeDecisions(
  conflicts: SyncConflict[],
  decisions: ConflictDecisions,
): Array<{ id: string; resolution: SyncConflictResolution }> {
  const out: Array<{ id: string; resolution: SyncConflictResolution }> = []
  for (const conflict of conflicts) {
    const resolution = decisions[conflict.id]
    if (resolution) out.push({ id: conflict.id, resolution })
  }
  return out
}

/**
 * 逐项裁决的推进：从 `from` 起（含自身之后，先向后再回头）找下一处还没决定的冲突。
 * 全部决定完返回 -1，UI 据此把焦点交给「应用」按钮。
 */
export function nextUndecidedIndex(
  conflicts: SyncConflict[],
  decisions: ConflictDecisions,
  from: number,
): number {
  if (!conflicts.length) return -1
  const start = Math.max(0, from)
  for (let step = 1; step <= conflicts.length; step += 1) {
    const index = (start + step) % conflicts.length
    if (!(conflicts[index]!.id in decisions)) return index
  }
  return -1
}
