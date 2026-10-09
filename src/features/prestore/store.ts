import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'

import { sha1Hex } from '../../lib/hash'
import { log } from '../../lib/logger'
import type { BodySource } from '../../lib/resolveBody'
import type { Article } from '../../lib/types'
import type { CategoryId } from '../../sources/categories'
import { compactPrestoreArticle, type PrestoreSyncCursor } from './model'

const ROOT_DIRECTORY = 'prestore/v1'
const BODY_DIRECTORY = `${ROOT_DIRECTORY}/articles`
const MANIFEST_FILES = {
  a: `${ROOT_DIRECTORY}/manifest-a.json`,
  b: `${ROOT_DIRECTORY}/manifest-b.json`,
} as const
const MANIFEST_VERSION = 1 as const
const BODY_VERSION = 1 as const

type ManifestSlot = keyof typeof MANIFEST_FILES

export interface PrestoreArticleEntry {
  sourceId: string
  bytes: number
  savedAt: number
  /** 列表渲染所需元数据也放 Filesystem，避免大批量预存挤占 DOM Storage。 */
  article: Article
}

export interface PrestoreSourceEntry {
  categoryId: CategoryId
  articleIds: string[]
}

export interface PrestoreManifest {
  version: typeof MANIFEST_VERSION
  revision: number
  presetId: string
  planKey: string
  perSourceLimit: number
  /** 上一次完整跑完一轮的时间；仅有断点检查点时保持上一轮的值（从未完成为 0）。 */
  updatedAt: number
  /** 存在即表示上一轮被中断，可从游标续传；跑完一轮后清空。 */
  sync?: PrestoreSyncCursor | null
  sources: Record<string, PrestoreSourceEntry>
  articles: Record<string, PrestoreArticleEntry>
}

interface PrestoreBodyFile {
  version: typeof BODY_VERSION
  article: Article
  html: string
  bodySource: BodySource
  savedAt: number
}

export interface PrestoredBody {
  article: Article
  html: string
  bodySource: BodySource
  savedAt: number
}

export interface PrestoreStats {
  articleCount: number
  sourceCount: number
  bytes: number
  updatedAt?: number
  presetId?: string
}

export interface PrestoreSnapshot {
  manifest: PrestoreManifest | null
  articleIds: Set<string>
  articles: Article[]
  stats: PrestoreStats
}

interface ManifestState {
  activeSlot: ManifestSlot
  manifest: PrestoreManifest | null
  backup: PrestoreManifest | null
}

let manifestStateCache: ManifestState | undefined
let manifestStatePromise: Promise<ManifestState> | null = null

function bodyFileName(articleId: string): string {
  return `${sha1Hex(encodeURIComponent(articleId))}.json`
}

function bodyPath(articleId: string): string {
  return `${BODY_DIRECTORY}/${bodyFileName(articleId)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeArticle(articleId: string, raw: unknown): Article | null {
  if (!isRecord(raw)) return null
  if (raw.id !== articleId || typeof raw.title !== 'string' || typeof raw.sourceId !== 'string') {
    return null
  }
  if (typeof raw.sourceName !== 'string' || typeof raw.sourceLabel !== 'string') return null
  if (typeof raw.originUrl !== 'string') return null
  return raw as unknown as Article
}

function normalizeSyncCursor(raw: unknown): PrestoreSyncCursor | null {
  if (!isRecord(raw)) return null
  if (typeof raw.planKey !== 'string' || typeof raw.presetId !== 'string') return null
  if (typeof raw.perSourceLimit !== 'number' || !Number.isFinite(raw.perSourceLimit)) return null
  if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) return null
  if (!Array.isArray(raw.visitedSourceIds)) return null
  return {
    planKey: raw.planKey,
    presetId: raw.presetId,
    perSourceLimit: Math.max(1, Math.floor(raw.perSourceLimit)),
    visitedSourceIds: [
      ...new Set(raw.visitedSourceIds.filter((id): id is string => typeof id === 'string' && Boolean(id))),
    ],
    updatedAt: raw.updatedAt,
  }
}

function normalizeManifest(raw: unknown): PrestoreManifest | null {
  if (!isRecord(raw) || raw.version !== MANIFEST_VERSION) return null
  if (typeof raw.revision !== 'number' || !Number.isFinite(raw.revision) || raw.revision < 1) return null
  if (typeof raw.presetId !== 'string' || typeof raw.planKey !== 'string') return null
  if (typeof raw.updatedAt !== 'number' || !Number.isFinite(raw.updatedAt)) return null
  if (typeof raw.perSourceLimit !== 'number' || !Number.isFinite(raw.perSourceLimit)) return null
  if (!isRecord(raw.sources) || !isRecord(raw.articles)) return null

  const articles: Record<string, PrestoreArticleEntry> = {}
  for (const [articleId, value] of Object.entries(raw.articles)) {
    if (!articleId || !isRecord(value)) continue
    const article = normalizeArticle(articleId, value.article)
    if (!article || typeof value.sourceId !== 'string' || value.sourceId !== article.sourceId) continue
    if (typeof value.bytes !== 'number' || !Number.isFinite(value.bytes) || value.bytes < 0) continue
    if (typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt)) continue
    articles[articleId] = {
      sourceId: value.sourceId,
      bytes: value.bytes,
      savedAt: value.savedAt,
      article,
    }
  }

  const sources: Record<string, PrestoreSourceEntry> = {}
  for (const [sourceId, value] of Object.entries(raw.sources)) {
    if (!sourceId || !isRecord(value) || typeof value.categoryId !== 'string') continue
    if (!Array.isArray(value.articleIds)) continue
    const articleIds = [
      ...new Set(
        value.articleIds.filter(
          (id): id is string =>
            typeof id === 'string' && articles[id]?.sourceId === sourceId,
        ),
      ),
    ]
    sources[sourceId] = { categoryId: value.categoryId, articleIds }
  }

  return {
    version: MANIFEST_VERSION,
    revision: Math.floor(raw.revision),
    presetId: raw.presetId,
    planKey: raw.planKey,
    perSourceLimit: Math.max(1, Math.floor(raw.perSourceLimit)),
    updatedAt: raw.updatedAt,
    sync: normalizeSyncCursor(raw.sync),
    sources,
    articles,
  }
}

async function readUtf8(path: string): Promise<string | null> {
  try {
    const result = await Filesystem.readFile({
      path,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    })
    return typeof result.data === 'string' ? result.data : null
  } catch {
    return null
  }
}

async function readManifestSlot(slot: ManifestSlot): Promise<PrestoreManifest | null> {
  const serialized = await readUtf8(MANIFEST_FILES[slot])
  if (!serialized) return null
  try {
    return normalizeManifest(JSON.parse(serialized))
  } catch {
    return null
  }
}

async function loadManifestState(): Promise<ManifestState> {
  if (manifestStateCache) return manifestStateCache
  if (manifestStatePromise) return manifestStatePromise

  manifestStatePromise = Promise.all([readManifestSlot('a'), readManifestSlot('b')])
    .then(([a, b]) => {
      const ranked = [
        ...(a ? [{ slot: 'a' as const, manifest: a }] : []),
        ...(b ? [{ slot: 'b' as const, manifest: b }] : []),
      ].sort(
        (left, right) =>
          right.manifest.revision - left.manifest.revision ||
          right.manifest.updatedAt - left.manifest.updatedAt,
      )
      const active = ranked[0]
      const backup = ranked[1]?.manifest ?? null
      const state: ManifestState = active
        ? { activeSlot: active.slot, manifest: active.manifest, backup }
        : { activeSlot: 'a', manifest: null, backup: null }
      manifestStateCache = state
      return state
    })
    .finally(() => {
      manifestStatePromise = null
    })

  return manifestStatePromise
}

export async function loadPrestoreManifest(): Promise<PrestoreManifest | null> {
  return (await loadManifestState()).manifest
}

export function emptyPrestoreSnapshot(): PrestoreSnapshot {
  return {
    manifest: null,
    articleIds: new Set(),
    articles: [],
    stats: { articleCount: 0, sourceCount: 0, bytes: 0 },
  }
}

export async function loadPrestoreSnapshot(): Promise<PrestoreSnapshot> {
  const manifest = await loadPrestoreManifest()
  if (!manifest) return emptyPrestoreSnapshot()

  const articleIds = new Set(Object.keys(manifest.articles))
  return {
    manifest,
    articleIds,
    articles: Object.values(manifest.articles).map((entry) => entry.article),
    stats: {
      articleCount: articleIds.size,
      sourceCount: Object.values(manifest.sources).filter((entry) => entry.articleIds.length > 0).length,
      bytes: Object.values(manifest.articles).reduce((total, entry) => total + entry.bytes, 0),
      updatedAt: manifest.updatedAt,
      presetId: manifest.presetId,
    },
  }
}

async function ensureDirectories(): Promise<void> {
  try {
    await Filesystem.mkdir({
      path: BODY_DIRECTORY,
      directory: Directory.Data,
      recursive: true,
    })
  } catch {
    // Existing directories may be reported as errors on some plugin versions.
  }
}

function encodedBytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

export async function writePrestoredBody(
  article: Article,
  body: { html: string; bodySource: BodySource },
): Promise<PrestoreArticleEntry> {
  const savedAt = Date.now()
  const compactArticle = compactPrestoreArticle(article)
  const record: PrestoreBodyFile = {
    version: BODY_VERSION,
    article: compactArticle,
    html: body.html,
    bodySource: body.bodySource,
    savedAt,
  }
  const serialized = JSON.stringify(record)
  await ensureDirectories()
  await Filesystem.writeFile({
    path: bodyPath(article.id),
    directory: Directory.Data,
    data: serialized,
    encoding: Encoding.UTF8,
  })
  return {
    sourceId: article.sourceId,
    bytes: encodedBytes(serialized),
    savedAt,
    article: compactArticle,
  }
}

async function readBodyFile(
  articleId: string,
): Promise<{ record: PrestoreBodyFile; bytes: number } | null> {
  try {
    const result = await Filesystem.readFile({
      path: bodyPath(articleId),
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    })
    if (typeof result.data !== 'string') return null
    const parsed = JSON.parse(result.data) as Partial<PrestoreBodyFile>
    if (
      parsed.version !== BODY_VERSION ||
      !parsed.article ||
      parsed.article.id !== articleId ||
      typeof parsed.html !== 'string' ||
      typeof parsed.bodySource !== 'string' ||
      typeof parsed.savedAt !== 'number'
    ) {
      return null
    }
    return { record: parsed as PrestoreBodyFile, bytes: encodedBytes(result.data) }
  } catch {
    // 认领遗留正文时“文件不存在”是常态，是否值得记日志交给调用方判断。
    return null
  }
}

export async function loadPrestoredBody(articleId: string): Promise<PrestoredBody | null> {
  const manifest = await loadPrestoreManifest()
  if (!manifest?.articles[articleId]) return null

  const file = await readBodyFile(articleId)
  if (!file) {
    log.storage.debug('Prestore body read failed', articleId)
    return null
  }
  return {
    article: file.record.article,
    html: file.record.html,
    bodySource: file.record.bodySource,
    savedAt: file.record.savedAt,
  }
}

/**
 * 认领上一轮中断时已落盘、但还没写进清单的正文。
 * 命中即可跳过一次网络抓取与正文解析，中断重来的代价被限制在本地读盘。
 */
export async function claimPrestoredBody(article: Article): Promise<PrestoreArticleEntry | null> {
  const file = await readBodyFile(article.id)
  if (!file || file.record.article.sourceId !== article.sourceId) return null
  return {
    sourceId: file.record.article.sourceId,
    bytes: file.bytes,
    savedAt: file.record.savedAt,
    article: file.record.article,
  }
}

function bodyFilesFor(manifest: PrestoreManifest | null): Set<string> {
  if (!manifest) return new Set()
  return new Set(Object.keys(manifest.articles).map(bodyFileName))
}

async function cleanupUnreferencedBodies(
  active: PrestoreManifest,
  backup: PrestoreManifest | null,
): Promise<void> {
  // 保留当前与上一代清单共同引用的正文：即使下一次清单写入损坏，仍可回退一代。
  const keep = bodyFilesFor(active)
  bodyFilesFor(backup).forEach((file) => keep.add(file))
  try {
    const result = await Filesystem.readdir({
      path: BODY_DIRECTORY,
      directory: Directory.Data,
    })
    await Promise.all(
      result.files
        .filter((file) => file.name.endsWith('.json') && !keep.has(file.name))
        .map((file) =>
          Filesystem.deleteFile({
            path: `${BODY_DIRECTORY}/${file.name}`,
            directory: Directory.Data,
          }).catch((error: unknown) => {
            log.storage.debug('Prestore orphan cleanup failed', file.name, error)
          }),
        ),
    )
  } catch {
    // No directory yet, or the platform has already removed it.
  }
}

/**
 * 双清单提交：永远写非活动槽，完整写入后才把它作为新活动版本。
 * 进程在 writeFile 中途退出时，上一槽仍然完整；下次启动会选择 revision 更高的有效清单。
 */
export async function commitPrestoreManifest(
  manifest: PrestoreManifest,
  options: { cleanupOrphans?: boolean } = {},
): Promise<void> {
  const previousState = await loadManifestState()
  const targetSlot: ManifestSlot = previousState.manifest
    ? previousState.activeSlot === 'a' ? 'b' : 'a'
    : 'a'
  await ensureDirectories()
  await Filesystem.writeFile({
    path: MANIFEST_FILES[targetSlot],
    directory: Directory.Data,
    data: JSON.stringify(manifest),
    encoding: Encoding.UTF8,
  })

  const previous = previousState.manifest
  manifestStateCache = {
    activeSlot: targetSlot,
    manifest,
    backup: previous,
  }
  manifestStatePromise = null
  // 断点检查点不清理孤儿：本轮已落盘、尚未入清单的正文要留给续传认领，
  // 统一等整轮跑完的最终提交再回收。
  if (options.cleanupOrphans !== false) await cleanupUnreferencedBodies(manifest, previous)
}

export async function clearPrestore(): Promise<void> {
  if (manifestStatePromise) {
    await manifestStatePromise.catch(() => undefined)
  }
  manifestStateCache = { activeSlot: 'a', manifest: null, backup: null }
  manifestStatePromise = null
  try {
    await Filesystem.rmdir({
      path: ROOT_DIRECTORY,
      directory: Directory.Data,
      recursive: true,
    })
  } catch {
    // Missing directory is already a cleared state.
  }
}
