/**
 * 远端记录 → 本机运行时状态。
 *
 * 做法是「投影层面合并」：先把本机状态投影出来，把远端记录覆盖上去，
 * 再从合并后的实体集合物化回 `Preferences` / `enabled` / `presets`。
 * 这样 projection 与 merge 天然互为逆运算，不会各写一套字段映射然后慢慢跑偏。
 *
 * 增量 pull 只会带来变化过的实体，所以必须以本机投影为底，不能整包重建。
 */

import type { SyncRecord } from '@newsnook/contracts'

import type { NewsCategory, CategoryId } from '../../sources/categories'
import { normalizeSourceKind, type NewsSource, type SourceGroup } from '../../sources/registry'
import { normalizePreferences, type Preferences } from '../../sources/preferences'
import { ensureValidActivePreset, normalizePresetsState, type PresetsState } from '../../sources/presets'
import type { CloudTranslationProviderId } from '../translation/types'
import {
  CLOUD_TRANSLATION_PROVIDER_IDS,
  PROXY_URL_SECRET_KEY,
  SETTING_KEYS,
  projectLocalState,
  translationSecretKey,
} from './projection'
import { entityKey, type LocalProjection } from './types'

export interface LocalRuntimeState {
  prefs: Preferences
  enabledIds: string[]
  presets: PresetsState
}

interface MergedEntity {
  entityType: SyncRecord['entityType']
  entityId: string
  payload: Record<string, unknown>
}

const SOURCE_GROUPS: SourceGroup[] = ['cn', 'intl', 'tech', 'ai', 'special', 'custom']

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function rankOf(payload: Record<string, unknown>): string {
  return typeof payload.sortRank === 'string' ? payload.sortRank : '\uffff'
}

/** 把远端记录盖到本机投影上：deleted 记录移除条目，其余覆盖 payload */
export function overlayRecords(
  projection: LocalProjection,
  records: SyncRecord[],
): Map<string, MergedEntity> {
  const merged = new Map<string, MergedEntity>()

  for (const [key, entity] of Object.entries(projection)) {
    merged.set(key, {
      entityType: entity.entityType,
      entityId: entity.entityId,
      payload: asRecord(entity.payload),
    })
  }

  for (const record of records) {
    const key = entityKey(record.entityType, record.entityId)
    if (record.deleted) {
      merged.delete(key)
      continue
    }
    merged.set(key, {
      entityType: record.entityType,
      entityId: record.entityId,
      payload: asRecord(record.payload),
    })
  }

  return merged
}

function byType(merged: Map<string, MergedEntity>, type: SyncRecord['entityType']): MergedEntity[] {
  const entities: MergedEntity[] = []
  for (const entity of merged.values()) {
    if (entity.entityType === type) entities.push(entity)
  }
  return entities.sort((left, right) => {
    const rank = rankOf(left.payload).localeCompare(rankOf(right.payload))
    return rank !== 0 ? rank : left.entityId.localeCompare(right.entityId)
  })
}

function toCustomSource(entity: MergedEntity): NewsSource | null {
  const { payload } = entity
  const url = text(payload.url)
  const name = text(payload.name)
  if (!url || !name) return null

  const group = SOURCE_GROUPS.includes(payload.group as SourceGroup)
    ? (payload.group as SourceGroup)
    : 'custom'

  const source: NewsSource = {
    id: entity.entityId,
    name,
    label: text(payload.label) ?? name.slice(0, 4),
    group,
    kind: normalizeSourceKind(text(payload.sourceKind)),
    url,
    siteUrl: text(payload.siteUrl),
    enabled: payload.enabled !== false,
    isCustom: true,
    createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : Date.now(),
  }
  if (payload.frameworkHint && typeof payload.frameworkHint === 'object') {
    source.frameworkHint = payload.frameworkHint as NewsSource['frameworkHint']
  }
  return source
}

function toCustomCategory(entity: MergedEntity): NewsCategory | null {
  const label = text(entity.payload.label)
  if (!label) return null
  const sourceIds = Array.isArray(entity.payload.sourceIds)
    ? entity.payload.sourceIds.filter((id): id is string => typeof id === 'string')
    : []

  return {
    id: entity.entityId,
    label,
    short: text(entity.payload.short) ?? label.slice(0, 4),
    // caption 由 normalizePreferences 依据信源重新生成，这里给占位即可
    caption: '',
    sourceIds,
    isCustom: true,
  }
}

function applySettings(prefs: Preferences, merged: Map<string, MergedEntity>): Preferences {
  const next: Preferences = { ...prefs }

  const readSetting = (key: string): unknown => {
    const entity = merged.get(entityKey('setting', key))
    return entity ? entity.payload.value : undefined
  }

  const typography = readSetting(SETTING_KEYS.typography)
  if (typography !== undefined) next.typography = typography as Preferences['typography']

  const theme = readSetting(SETTING_KEYS.theme)
  if (theme !== undefined) next.theme = theme as Preferences['theme']

  const scheme = readSetting(SETTING_KEYS.scheme)
  if (scheme !== undefined) next.scheme = scheme as Preferences['scheme']

  const customScheme = readSetting(SETTING_KEYS.customScheme)
  if (customScheme !== undefined) next.customScheme = customScheme as Preferences['customScheme']

  const translation = readSetting(SETTING_KEYS.translation)
  if (translation !== undefined) {
    // 远端的 translation 设置里 apiKey 一律是空串，密钥由 secret 分支单独补回
    next.translation = translation as Preferences['translation']
  }

  const proxy = readSetting(SETTING_KEYS.proxy)
  if (proxy !== undefined) {
    const remote = asRecord(proxy)
    next.proxy = {
      ...prefs.proxy,
      mode: (remote.mode as Preferences['proxy']['mode']) ?? prefs.proxy.mode,
      customBypassDomains: Array.isArray(remote.customBypassDomains)
        ? (remote.customBypassDomains as string[])
        : prefs.proxy.customBypassDomains,
      customProxyDomains: Array.isArray(remote.customProxyDomains)
        ? (remote.customProxyDomains as string[])
        : prefs.proxy.customProxyDomains,
    }
  }

  const autoRefresh = readSetting(SETTING_KEYS.autoRefresh)
  if (autoRefresh !== undefined) next.autoRefreshOnCategorySwitch = autoRefresh !== false

  const recommend = readSetting(SETTING_KEYS.recommend)
  if (recommend !== undefined) next.recommendEnabled = recommend !== false

  return next
}

/** Secret 只回填运行时值，不参与普通设置的 diff */
function applySecrets(prefs: Preferences, merged: Map<string, MergedEntity>): Preferences {
  const cloud = { ...prefs.translation.cloud }

  for (const provider of CLOUD_TRANSLATION_PROVIDER_IDS) {
    const entity = merged.get(entityKey('secret', translationSecretKey(provider)))
    const value = entity ? text(entity.payload.value) ?? '' : ''
    cloud[provider] = { ...cloud[provider], apiKey: value }
  }

  const proxySecret = merged.get(entityKey('secret', PROXY_URL_SECRET_KEY))

  return {
    ...prefs,
    translation: { ...prefs.translation, cloud },
    proxy: { ...prefs.proxy, proxyUrl: proxySecret ? (text(proxySecret.payload.value) ?? '') : '' },
  }
}

function applySubscriptions(
  prefs: Preferences,
  merged: Map<string, MergedEntity>,
): { prefs: Preferences; enabledIds: string[] } {
  const subscriptions = byType(merged, 'subscription')

  const customSources: NewsSource[] = []
  const enabledIds: string[] = []

  for (const entity of subscriptions) {
    if (entity.payload.kind === 'custom') {
      const source = toCustomSource(entity)
      if (source) customSources.push(source)
      if (source && entity.payload.enabled !== false) enabledIds.push(source.id)
      continue
    }
    if (entity.payload.enabled !== false) enabledIds.push(entity.entityId)
  }

  return { prefs: { ...prefs, customSources }, enabledIds }
}

function applyCategories(prefs: Preferences, merged: Map<string, MergedEntity>): Preferences {
  const categories = byType(merged, 'category')
  if (!categories.length) return prefs

  const categoryOrder: CategoryId[] = []
  const hiddenCategoryIds: CategoryId[] = []
  const categorySources: Record<CategoryId, string[]> = {}
  const customCategories: NewsCategory[] = []

  for (const entity of categories) {
    categoryOrder.push(entity.entityId)
    if (entity.payload.visible === false) hiddenCategoryIds.push(entity.entityId)

    if (entity.payload.kind === 'custom') {
      const category = toCustomCategory(entity)
      if (category) customCategories.push(category)
      continue
    }
    if (Array.isArray(entity.payload.sourceIds)) {
      categorySources[entity.entityId] = entity.payload.sourceIds.filter(
        (id): id is string => typeof id === 'string',
      )
    }
  }

  return { ...prefs, categoryOrder, hiddenCategoryIds, categorySources, customCategories }
}

function applyPresets(current: PresetsState, merged: Map<string, MergedEntity>): PresetsState {
  const entity = merged.get(entityKey('setting', SETTING_KEYS.presets))
  if (!entity) return current
  const normalized = normalizePresetsState(entity.payload.value)
  return normalized ? ensureValidActivePreset(normalized) : current
}

/**
 * 把一批远端记录合并进本机状态。
 * 设备本地设置（墨水屏 / Wi-Fi 媒体 / 预存）始终取 `current`，远端不会覆盖它们。
 */
export function applyRemoteRecords(
  current: LocalRuntimeState,
  records: SyncRecord[],
): LocalRuntimeState {
  if (!records.length) return current

  const projection = projectLocalState(current)
  const merged = overlayRecords(projection, records)

  let prefs = applyCategories(current.prefs, merged)
  const subscriptions = applySubscriptions(prefs, merged)
  prefs = subscriptions.prefs
  prefs = applySettings(prefs, merged)
  prefs = applySecrets(prefs, merged)

  return {
    prefs: normalizePreferences(prefs),
    enabledIds: subscriptions.enabledIds,
    presets: applyPresets(current.presets, merged),
  }
}

export type { CloudTranslationProviderId }
