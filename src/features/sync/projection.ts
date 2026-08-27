/**
 * 本地投影：把「运行时真相」（Preferences + 频道启用列表 + 场景预设）
 * 映射成同步协议的实体集合。
 *
 * 这里只读不写：`Preferences`、`enabled`、`presets` 仍然是本机的唯一真相，
 * 同步不为自己另建一套配置存储。
 */

import { rankForIndex } from '@newsnook/contracts/protocol'

import { CATEGORIES, type CategoryId } from '../../sources/categories'
import { SOURCES, type NewsSource } from '../../sources/registry'
import type { Preferences } from '../../sources/preferences'
import type { PresetsState } from '../../sources/presets'
import type { CloudTranslationProviderId } from '../translation/types'
import { fingerprintOf } from './fingerprint'
import { entityKey, type LocalProjection, type ProjectedEntity } from './types'

/** 跨设备同步的普通设置键；值本身是任意 JSON，语义只有客户端理解 */
export const SETTING_KEYS = {
  typography: 'typography',
  theme: 'theme',
  scheme: 'scheme',
  customScheme: 'customScheme',
  translation: 'translation',
  proxy: 'proxy',
  autoRefresh: 'autoRefreshOnCategorySwitch',
  recommend: 'recommendEnabled',
  presets: 'presets',
} as const

/**
 * 明确留在本机、永远不上传的设置。
 * 墨水屏与流量策略跟着具体硬件走，预存策略跟着本机存储容量走。
 */
export const DEVICE_LOCAL_SETTING_FIELDS = [
  'einkMode',
  'wifiOnlyAutoLoadMedia',
  'prestore',
] as const

export const CLOUD_TRANSLATION_PROVIDER_IDS: CloudTranslationProviderId[] = [
  'google',
  'azure',
  'deepl',
  'deeplx',
  'openai',
]

export const PROXY_URL_SECRET_KEY = 'proxy.url'

export function translationSecretKey(provider: CloudTranslationProviderId): string {
  return `translation.${provider}.apiKey`
}

export interface ProjectionInput {
  prefs: Preferences
  enabledIds: string[]
  presets: PresetsState
}

/**
 * Secret 在 `Preferences` 里的落点。
 *
 * 同步、Keystore 迁移与运行时回填三处共用这张表：Secret 的键名只在这里定义一次，
 * 新增一种密钥时不必再去改存储层。
 */
export interface SecretField {
  key: string
  read: (prefs: Preferences) => string
  write: (prefs: Preferences, value: string) => Preferences
}

export const SECRET_FIELDS: readonly SecretField[] = [
  ...CLOUD_TRANSLATION_PROVIDER_IDS.map((provider) => ({
    key: translationSecretKey(provider),
    read: (prefs: Preferences) => prefs.translation.cloud[provider]?.apiKey ?? '',
    write: (prefs: Preferences, value: string): Preferences => ({
      ...prefs,
      translation: {
        ...prefs.translation,
        cloud: {
          ...prefs.translation.cloud,
          [provider]: { ...prefs.translation.cloud[provider], apiKey: value },
        },
      },
    }),
  })),
  {
    key: PROXY_URL_SECRET_KEY,
    read: (prefs: Preferences) => prefs.proxy.proxyUrl ?? '',
    write: (prefs: Preferences, value: string): Preferences => ({
      ...prefs,
      proxy: { ...prefs.proxy, proxyUrl: value },
    }),
  },
]

/** 当前偏好里所有非空 Secret；空值不出现在结果里 */
export function collectSecrets(prefs: Preferences): Record<string, string> {
  const values: Record<string, string> = {}
  for (const field of SECRET_FIELDS) {
    const value = field.read(prefs)
    if (value) values[field.key] = value
  }
  return values
}

/** 把 Secret 字段清空，用于落盘前的净化（明文只留在内存与 Keystore） */
export function stripSecrets(prefs: Preferences): Preferences {
  let next = prefs
  for (const field of SECRET_FIELDS) {
    if (field.read(next)) next = field.write(next, '')
  }
  return next
}

/** 把安全存储里的明文回填到运行时偏好；缺失的键保持原值不动 */
export function applySecrets(prefs: Preferences, values: Record<string, string>): Preferences {
  let next = prefs
  for (const field of SECRET_FIELDS) {
    const value = values[field.key]
    if (typeof value === 'string' && value !== field.read(next)) next = field.write(next, value)
  }
  return next
}

const BUILTIN_SOURCE_IDS = new Set(SOURCES.map((source) => source.id))
const BUILTIN_CATEGORY_IDS = CATEGORIES.map((category) => category.id)

function project(
  target: LocalProjection,
  entityType: ProjectedEntity['entityType'],
  entityId: string,
  payload: unknown,
): void {
  target[entityKey(entityType, entityId)] = {
    entityType,
    entityId,
    payload,
    fingerprint: fingerprintOf(payload),
  }
}

/** 自建源跨设备去重用：只做协议层面的粗归一，不改本机 id 规则 */
export function normalizeSubscriptionUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''
  try {
    const parsed = new URL(trimmed)
    const path = parsed.pathname.replace(/\/+$/, '')
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${path}${parsed.search}`
  } catch {
    return trimmed.replace(/\/+$/, '')
  }
}

function customSourcePayload(source: NewsSource, enabled: boolean, sortRank: string): unknown {
  return {
    kind: 'custom',
    enabled,
    sortRank,
    name: source.name,
    label: source.label,
    group: source.group,
    sourceKind: source.kind,
    url: source.url,
    siteUrl: source.siteUrl,
    normalizedUrl: normalizeSubscriptionUrl(source.url),
    createdAt: source.createdAt,
    frameworkHint: source.frameworkHint,
  }
}

/**
 * 订阅投影。
 *
 * 内置源只在被启用时才是一条「订阅」，停用等于取消订阅（生成 tombstone）。
 * 自建源不同：它携带用户输入的元数据，停用后仍必须留在云端，
 * 否则另一台设备会连源定义一起丢失，只能让用户重新添加。
 */
function projectSubscriptions(target: LocalProjection, input: ProjectionInput): void {
  const { prefs, enabledIds } = input
  const customSources = prefs.customSources ?? []
  const customById = new Map(customSources.map((source) => [source.id, source]))
  const enabledSet = new Set(enabledIds)

  const ordered: string[] = []
  for (const id of enabledIds) {
    if (BUILTIN_SOURCE_IDS.has(id) || customById.has(id)) ordered.push(id)
  }
  for (const source of customSources) {
    if (!enabledSet.has(source.id)) ordered.push(source.id)
  }

  ordered.forEach((id, index) => {
    const sortRank = rankForIndex(index)
    const custom = customById.get(id)
    if (custom) {
      project(target, 'subscription', id, customSourcePayload(custom, enabledSet.has(id), sortRank))
      return
    }
    project(target, 'subscription', id, { kind: 'builtin', enabled: true, sortRank })
  })
}

/**
 * 分类投影：内置与自建分类都投影，rank 来自「实际展示顺序」。
 * `categoryOrder` 没列到的分类按注册表顺序排在后面，与运行时行为一致。
 */
function projectCategories(target: LocalProjection, input: ProjectionInput): void {
  const { prefs } = input
  const customCategories = prefs.customCategories ?? []
  const customById = new Map(customCategories.map((category) => [category.id, category]))

  const allIds: CategoryId[] = [...BUILTIN_CATEGORY_IDS, ...customById.keys()]
  const known = new Set(allIds)
  const explicitOrder = prefs.categoryOrder.filter((id) => known.has(id))
  const ordered = [...explicitOrder, ...allIds.filter((id) => !explicitOrder.includes(id))]

  const hidden = new Set(prefs.hiddenCategoryIds)

  ordered.forEach((id, index) => {
    const sortRank = rankForIndex(index)
    const custom = customById.get(id)
    if (custom) {
      project(target, 'category', id, {
        kind: 'custom',
        visible: !hidden.has(id),
        sortRank,
        sourceIds: custom.sourceIds ?? [],
        label: custom.label,
        short: custom.short,
      })
      return
    }
    project(target, 'category', id, {
      kind: 'builtin',
      visible: !hidden.has(id),
      sortRank,
      // null 表示沿用注册表默认信源，与「用户显式选了空集」区分开
      sourceIds: prefs.categorySources[id] ?? null,
    })
  })
}

/** 翻译设置去掉 apiKey：密钥单独作为 secret 实体走加密通道 */
function translationSetting(prefs: Preferences): unknown {
  const cloud: Record<string, unknown> = {}
  for (const provider of CLOUD_TRANSLATION_PROVIDER_IDS) {
    const config = prefs.translation.cloud[provider]
    cloud[provider] = { ...config, apiKey: '' }
  }
  return { ...prefs.translation, cloud }
}

function proxySetting(prefs: Preferences): unknown {
  return {
    mode: prefs.proxy.mode,
    customBypassDomains: prefs.proxy.customBypassDomains,
    customProxyDomains: prefs.proxy.customProxyDomains,
  }
}

function projectSettings(target: LocalProjection, input: ProjectionInput): void {
  const { prefs, presets } = input

  project(target, 'setting', SETTING_KEYS.typography, { value: prefs.typography })
  project(target, 'setting', SETTING_KEYS.theme, { value: prefs.theme })
  project(target, 'setting', SETTING_KEYS.scheme, { value: prefs.scheme })
  if (prefs.customScheme) {
    project(target, 'setting', SETTING_KEYS.customScheme, { value: prefs.customScheme })
  }
  project(target, 'setting', SETTING_KEYS.translation, { value: translationSetting(prefs) })
  project(target, 'setting', SETTING_KEYS.proxy, { value: proxySetting(prefs) })
  project(target, 'setting', SETTING_KEYS.autoRefresh, {
    value: prefs.autoRefreshOnCategorySwitch !== false,
  })
  project(target, 'setting', SETTING_KEYS.recommend, { value: prefs.recommendEnabled !== false })
  // 场景预设整体作为一个实体：拆细粒度只会带来大量无意义的排序冲突
  project(target, 'setting', SETTING_KEYS.presets, { value: presets })
}

/**
 * Secret 投影：值为空表示用户清掉了密钥，直接不投影，
 * reconcile 会据此生成 delete，让另一台设备也把它清掉。
 */
function projectSecrets(target: LocalProjection, input: ProjectionInput): void {
  const { prefs } = input

  for (const provider of CLOUD_TRANSLATION_PROVIDER_IDS) {
    const apiKey = prefs.translation.cloud[provider]?.apiKey ?? ''
    if (!apiKey) continue
    project(target, 'secret', translationSecretKey(provider), { value: apiKey })
  }

  const proxyUrl = prefs.proxy.proxyUrl ?? ''
  if (proxyUrl) project(target, 'secret', PROXY_URL_SECRET_KEY, { value: proxyUrl })
}

export function projectLocalState(input: ProjectionInput): LocalProjection {
  const projection: LocalProjection = {}
  projectSubscriptions(projection, input)
  projectCategories(projection, input)
  projectSettings(projection, input)
  projectSecrets(projection, input)
  return projection
}
