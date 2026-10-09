/**
 * 首次登录的数据归属决策（纯逻辑，UI 只负责展示与点按）。
 *
 * 规则很硬：本机与云端都有内容时，必须由用户明确选一次，绝不自动覆盖。
 * 只有一边为空时才允许自动选择——那种情况下没有任何数据会被丢掉。
 */

import type { SyncBootstrapResponse } from '@newsnook/contracts'

import type { LocalProjection } from './types'

export type FirstSyncChoice = 'local' | 'cloud' | 'merge'

export interface FirstSyncCounts {
  subscriptions: number
  categories: number
  settings: number
  secrets: number
}

export interface FirstSyncDecision {
  local: FirstSyncCounts
  cloud: FirstSyncCounts
  /** 两边都有内容时为 true：必须让用户选 */
  mustAsk: boolean
  /** 只有一边有内容时给出的安全默认；`mustAsk` 为 true 时是建议值 */
  suggestion: FirstSyncChoice
  cloudLastUpdatedAt: number | null
}

export function countProjection(projection: LocalProjection): FirstSyncCounts {
  const counts: FirstSyncCounts = { subscriptions: 0, categories: 0, settings: 0, secrets: 0 }
  for (const entity of Object.values(projection)) {
    if (entity.entityType === 'subscription') counts.subscriptions += 1
    else if (entity.entityType === 'category') counts.categories += 1
    else if (entity.entityType === 'setting') counts.settings += 1
    else counts.secrets += 1
  }
  return counts
}

function hasContent(counts: FirstSyncCounts): boolean {
  return counts.subscriptions > 0 || counts.categories > 0 || counts.secrets > 0
}

export function decideFirstSync(
  projection: LocalProjection,
  bootstrap: SyncBootstrapResponse,
): FirstSyncDecision {
  const local = countProjection(projection)
  const cloud: FirstSyncCounts = {
    subscriptions: bootstrap.counts.subscriptions,
    categories: bootstrap.counts.categories,
    settings: bootstrap.counts.settings,
    secrets: bootstrap.counts.secrets,
  }

  const cloudHas = hasContent(cloud)
  const localHas = hasContent(local)

  return {
    local,
    cloud,
    mustAsk: cloudHas && localHas,
    // 云端空 -> 本机就是唯一的数据；本机空（罕见，通常是新装）-> 直接用云端
    suggestion: !cloudHas ? 'local' : !localHas ? 'cloud' : 'merge',
    cloudLastUpdatedAt: bootstrap.lastUpdatedAt,
  }
}

export function describeCounts(counts: FirstSyncCounts): string {
  return `${counts.subscriptions} 订阅 · ${counts.categories} 分类 · ${counts.settings} 项设置`
}
