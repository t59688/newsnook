/**
 * 本地配置备份与恢复：把本机关键配置导出成一个 JSON 文件，换机或重装时导回来。
 *
 * 与 OPML 的分工：OPML 只覆盖订阅源本身（可与其它阅读器互通）；
 * 本备份覆盖偏好、场景预设、启用信源、稍后读、已读与阅读位置，是「有所闻」自有格式。
 *
 * 边界：只搬配置，不搬缓存。正文缓存、列表缓存、预存正文都可再生，不进备份文件。
 * 全程本地文件，无账号、无云同步。
 */

import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'

import { log } from './logger'
import {
  READING_POSITION_KEY,
  clearSyncSafetySnapshot,
  loadEnabledSources,
  loadIdSet,
  loadLaterArticles,
  loadPreferences,
  loadPresetsState,
  loadReadingPositions,
  loadSyncSafetySnapshot,
  saveSyncSafetySnapshot,
  writeRestoredKeys,
} from './storage'
import { normalizeReadingPositions, resetReadingPositionCache } from './readingPosition'
import { normalizePreferences } from '../sources/preferences'
import { normalizePresetsState } from '../sources/presets'
import type { Article } from './types'

export const BACKUP_FORMAT = 'newsnook-backup'
export const BACKUP_VERSION = 1

/** 备份里可选择性恢复的分区；与 UI 勾选项一一对应 */
export type BackupSection =
  | 'preferences'
  | 'presets'
  | 'enabledSources'
  | 'laterItems'
  | 'readIds'
  | 'readingPositions'

export const BACKUP_SECTIONS: BackupSection[] = [
  'preferences',
  'presets',
  'enabledSources',
  'laterItems',
  'readIds',
  'readingPositions',
]

export const BACKUP_SECTION_LABELS: Record<BackupSection, string> = {
  preferences: '偏好与自建订阅',
  presets: '场景预设',
  enabledSources: '启用信源',
  laterItems: '稍后读',
  readIds: '已读标记',
  readingPositions: '阅读位置',
}

export interface BackupData {
  /** 偏好整包：外观、排版、翻译、代理、分类布局、自建分类与自建订阅源 */
  preferences?: unknown
  presets?: unknown
  enabledSources?: string[]
  laterItems?: Article[]
  readIds?: string[]
  readingPositions?: unknown
}

export interface BackupPayload {
  format: typeof BACKUP_FORMAT
  version: number
  exportedAt: number
  /** 导出时的应用版本，仅用于展示与排查 */
  appVersion?: string
  data: BackupData
}

export interface BackupSummary {
  exportedAt: number
  appVersion?: string
  version: number
  /** 该分区在这份备份里有内容 */
  present: Record<BackupSection, boolean>
  customSourceCount: number
  customCategoryCount: number
  presetCount: number
  enabledSourceCount: number
  laterCount: number
  readCount: number
  readingPositionCount: number
}

const STORAGE_KEY_BY_SECTION: Record<BackupSection, string> = {
  preferences: 'preferences',
  presets: 'presets',
  enabledSources: 'enabled',
  laterItems: 'later-items',
  readIds: 'read',
  readingPositions: READING_POSITION_KEY,
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && !!item))]
}

/** 备份只留元数据；正文可再生，塞进来会让文件迅速膨胀到不可分享 */
function compactArticle(article: Article): Article {
  const { contentHtml: _contentHtml, ...metadata } = article
  return metadata
}

function articleArray(value: unknown): Article[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(
      (item): item is Article =>
        isPlainObject(item) && typeof item.id === 'string' && typeof item.title === 'string',
    )
    .map(compactArticle)
}

/** 采集当前本机配置。读不到的分区直接缺省，不写空壳。 */
export function collectBackup(appVersion?: string): BackupPayload {
  const preferences = loadPreferences()
  const presets = loadPresetsState()
  const enabled = loadEnabledSources()
  const laterItems = loadLaterArticles()
  const readIds = [...loadIdSet('read')]
  const readingPositions = normalizeReadingPositions(loadReadingPositions())

  const data: BackupData = {}
  if (preferences != null) data.preferences = preferences
  if (presets != null) data.presets = presets
  if (enabled?.length) data.enabledSources = enabled
  if (laterItems.length) data.laterItems = laterItems.map(compactArticle)
  if (readIds.length) data.readIds = readIds
  if (Object.keys(readingPositions).length) data.readingPositions = readingPositions

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: Date.now(),
    ...(appVersion ? { appVersion } : {}),
    data,
  }
}

export function serializeBackup(payload: BackupPayload): string {
  return `${JSON.stringify(payload, null, 2)}\n`
}

/**
 * 版本迁移：老版本备份在这里补齐字段后再交给校验。
 * 目前只有 v1；新增字段时优先做可逆的「缺省即默认」，避免写破坏性迁移。
 */
function migrate(payload: BackupPayload): BackupPayload {
  if (payload.version >= BACKUP_VERSION) return payload
  return { ...payload, version: BACKUP_VERSION }
}

/** 解析并校验备份文本；失败时抛出面向用户的中文原因 */
export function parseBackup(text: string): BackupPayload {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('不是有效的 JSON 文件，请确认选中的是「有所闻」导出的备份。')
  }

  if (!isPlainObject(raw)) {
    throw new Error('备份内容不是一个对象，无法识别。')
  }
  if (raw.format !== BACKUP_FORMAT) {
    throw new Error('这不是「有所闻」的配置备份文件（缺少 format 标记）。')
  }

  const version = typeof raw.version === 'number' ? raw.version : 0
  if (!Number.isInteger(version) || version < 1) {
    throw new Error('备份缺少有效的版本号，无法安全恢复。')
  }
  if (version > BACKUP_VERSION) {
    throw new Error(`备份来自更新的版本（v${version}），请先升级应用后再导入。`)
  }
  if (!isPlainObject(raw.data)) {
    throw new Error('备份缺少 data 段，可能已损坏。')
  }

  const source = raw.data
  const data: BackupData = {}
  if (source.preferences != null) data.preferences = source.preferences
  if (source.presets != null) data.presets = source.presets

  const enabled = stringArray(source.enabledSources)
  if (enabled.length) data.enabledSources = enabled

  const laterItems = articleArray(source.laterItems)
  if (laterItems.length) data.laterItems = laterItems

  const readIds = stringArray(source.readIds)
  if (readIds.length) data.readIds = readIds

  const positions = normalizeReadingPositions(source.readingPositions)
  if (Object.keys(positions).length) data.readingPositions = positions

  if (!Object.keys(data).length) {
    throw new Error('备份里没有任何可恢复的配置。')
  }

  return migrate({
    format: BACKUP_FORMAT,
    version,
    exportedAt: typeof raw.exportedAt === 'number' ? raw.exportedAt : 0,
    ...(typeof raw.appVersion === 'string' ? { appVersion: raw.appVersion } : {}),
    data,
  })
}

/** 导入确认弹窗用：不落盘，先把这份备份里有什么讲清楚 */
export function summarizeBackup(payload: BackupPayload): BackupSummary {
  const { data } = payload
  const prefs = data.preferences != null ? normalizePreferences(data.preferences) : null
  const presets = data.presets != null ? normalizePresetsState(data.presets) : null
  const positions = normalizeReadingPositions(data.readingPositions)

  return {
    exportedAt: payload.exportedAt,
    appVersion: payload.appVersion,
    version: payload.version,
    present: {
      preferences: data.preferences != null,
      presets: data.presets != null,
      enabledSources: Boolean(data.enabledSources?.length),
      laterItems: Boolean(data.laterItems?.length),
      readIds: Boolean(data.readIds?.length),
      readingPositions: Object.keys(positions).length > 0,
    },
    customSourceCount: prefs?.customSources?.length ?? 0,
    customCategoryCount: prefs?.customCategories?.length ?? 0,
    presetCount: presets?.userPresets.length ?? 0,
    enabledSourceCount: data.enabledSources?.length ?? 0,
    laterCount: data.laterItems?.length ?? 0,
    readCount: data.readIds?.length ?? 0,
    readingPositionCount: Object.keys(positions).length,
  }
}

export interface RestoreResult {
  restored: BackupSection[]
  skipped: BackupSection[]
}

/**
 * 整段覆盖所选分区。写盘前先跑一遍各自的 normalize，
 * 保证脏备份不会把运行态带进无法启动的形状。
 *
 * 调用方需要在 await 之后重载应用：偏好、预设等运行态都在 React state 里，
 * 只写存储不会让当前界面跟上。
 */
export async function restoreBackup(
  payload: BackupPayload,
  sections: BackupSection[] = BACKUP_SECTIONS,
): Promise<RestoreResult> {
  const wanted = new Set(sections)
  const entries: [string, unknown][] = []
  const restored: BackupSection[] = []
  const skipped: BackupSection[] = []

  const push = (section: BackupSection, value: unknown) => {
    if (!wanted.has(section) || value == null) {
      skipped.push(section)
      return
    }
    entries.push([STORAGE_KEY_BY_SECTION[section], value])
    restored.push(section)
  }

  const { data } = payload
  push('preferences', data.preferences != null ? normalizePreferences(data.preferences) : null)
  push('presets', data.presets != null ? normalizePresetsState(data.presets) : null)
  push('enabledSources', data.enabledSources?.length ? data.enabledSources : null)
  push('laterItems', data.laterItems?.length ? data.laterItems : null)
  push('readIds', data.readIds?.length ? data.readIds : null)

  const positions = normalizeReadingPositions(data.readingPositions)
  push('readingPositions', Object.keys(positions).length ? positions : null)

  if (entries.length) {
    await writeRestoredKeys(entries)
    resetReadingPositionCache()
    log.storage.info('backup restored', { sections: restored })
  }

  return { restored, skipped }
}

/**
 * 首次同步前的安全快照。
 *
 * 「使用云端数据」这类选择会整包替换同步域，用户后悔了得有地方找回来。
 * 只抓同步范围内的三块（偏好 / 场景预设 / 启用信源）——稍后读、已读、
 * 阅读历史与阅读位置本来就不参与同步，不会被覆盖，也就不必快照。
 * 只保留最近一份，避免把 localStorage 撑爆。
 */
export const SYNC_SAFETY_SECTIONS: BackupSection[] = ['preferences', 'presets', 'enabledSources']

export interface SyncSafetySnapshot {
  createdAt: number
  payload: BackupPayload
}

export function captureSyncSafetySnapshot(appVersion?: string): SyncSafetySnapshot {
  const full = collectBackup(appVersion)
  const data: BackupData = {}
  if (full.data.preferences != null) data.preferences = full.data.preferences
  if (full.data.presets != null) data.presets = full.data.presets
  if (full.data.enabledSources?.length) data.enabledSources = full.data.enabledSources

  const snapshot: SyncSafetySnapshot = {
    createdAt: Date.now(),
    payload: { ...full, data },
  }
  saveSyncSafetySnapshot(snapshot)
  log.sync.info('captured pre-sync safety snapshot')
  return snapshot
}

export function readSyncSafetySnapshot(): SyncSafetySnapshot | null {
  const raw = loadSyncSafetySnapshot()
  if (!isPlainObject(raw)) return null
  try {
    return {
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
      payload: parseBackup(JSON.stringify(raw.payload)),
    }
  } catch {
    // 快照损坏就当没有：它只是兜底，不该阻塞任何同步动作
    return null
  }
}

/** 「恢复同步前的配置」：只回滚同步域，调用方随后重载应用 */
export async function restoreSyncSafetySnapshot(): Promise<RestoreResult | null> {
  const snapshot = readSyncSafetySnapshot()
  if (!snapshot) return null
  return restoreBackup(snapshot.payload, SYNC_SAFETY_SECTIONS)
}

export function dropSyncSafetySnapshot(): void {
  clearSyncSafetySnapshot()
}

export function backupFileName(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `newsnook-backup-${stamp}.json`
}

/** 触发浏览器下载备份文件（与 OPML 导出同一套本地下载路径） */
export function downloadBackupFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename.endsWith('.json') ? filename : `${filename}.json`
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export type BackupExportResult = 'downloaded' | 'shared'

/**
 * 落地备份文件：Android 写进应用缓存目录再走系统分享（存到网盘 / 发给自己都行），
 * Web 仍是普通下载。两条路径都不经过任何服务端。
 */
export async function exportBackupFile(
  filename: string,
  content: string,
): Promise<BackupExportResult> {
  if (!Capacitor.isNativePlatform()) {
    downloadBackupFile(filename, content)
    return 'downloaded'
  }

  await Filesystem.writeFile({
    path: filename,
    data: content,
    directory: Directory.Cache,
    encoding: Encoding.UTF8,
  })
  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache })
  await Share.share({
    title: '有所闻 配置备份',
    dialogTitle: '保存或发送备份文件',
    files: [uri],
  })
  return 'shared'
}
