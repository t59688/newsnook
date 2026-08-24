import { mapConcurrent } from '../../lib/asyncPool'
import { log } from '../../lib/logger'
import { resolveArticleBody } from '../../lib/resolveBody'
import type { Article } from '../../lib/types'
import type { NewsSource } from '../../sources/registry'
import { revokeBlobUrl } from '../proxy/hydrateImages'
import {
  mergeRollingWindow,
  prestoreCandidateLimit,
  resumableVisitedSources,
  seedPrestoreWindows,
  type PrestorePlan,
  type PrestoreSourceTarget,
  type PrestoreSyncCursor,
} from './model'
import { fetchSourcePrestoreCandidates } from './sourceWindow'
import {
  claimPrestoredBody,
  commitPrestoreManifest,
  loadPrestoreManifest,
  writePrestoredBody,
  type PrestoreArticleEntry,
  type PrestoreManifest,
} from './store'

const BODY_CONCURRENCY = 2

export type PrestoreProgressPhase = 'listing' | 'bodies' | 'source-complete'

export interface PrestoreProgress {
  phase: PrestoreProgressPhase
  sourceIndex: number
  totalSources: number
  sourceId: string
  sourceName: string
  storedInSource: number
  targetPerSource: number
  completedSources: number
  failedBodies: number
  failedSources: number
}

export interface PrestoreSyncResult {
  manifest: PrestoreManifest | null
  syncedSources: number
  failedSources: number
  failedBodies: number
}

interface SyncOptions {
  plan: PrestorePlan
  perSourceLimit: number
  signal: AbortSignal
  extraSources?: NewsSource[]
  onProgress?: (progress: PrestoreProgress) => void
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('操作已取消', 'AbortError')
}

function emitProgress(
  options: SyncOptions,
  target: PrestoreSourceTarget,
  sourceIndex: number,
  phase: PrestoreProgressPhase,
  storedInSource: number,
  completedSources: number,
  failedBodies: number,
  failedSources: number,
): void {
  options.onProgress?.({
    phase,
    sourceIndex,
    totalSources: options.plan.sources.length,
    sourceId: target.source.id,
    sourceName: target.source.name,
    storedInSource,
    targetPerSource: options.perSourceLimit,
    completedSources,
    failedBodies,
    failedSources,
  })
}

function makePortableBodyHtml(html: string): string {
  const blobUrls = [...new Set(html.match(/blob:[^"'()<>\s]+/g) ?? [])]
  const portable = html.replace(/blob:[^"'()<>\s]+/g, '')
  blobUrls.forEach(revokeBlobUrl)
  return portable
}

async function prepareBody(
  article: Article,
  previous: PrestoreManifest | null,
  nextArticles: Record<string, PrestoreArticleEntry>,
  signal: AbortSignal,
  claimOrphans: boolean,
  extraSources?: NewsSource[],
): Promise<{ id: string; entry: PrestoreArticleEntry } | null> {
  if (article.contentType === 'video') return null

  const alreadySelected = nextArticles[article.id]
  if (alreadySelected) return { id: article.id, entry: alreadySelected }

  const previousEntry = previous?.articles[article.id]
  if (previousEntry) return { id: article.id, entry: previousEntry }

  if (claimOrphans) {
    const claimed = await claimPrestoredBody(article)
    if (claimed) return { id: article.id, entry: claimed }
  }

  const resolved = await resolveArticleBody(article, signal, extraSources)
  if (resolved.bodySource === 'video' || resolved.bodySource === 'blocked') return null
  const entry = await writePrestoredBody(article, {
    // resolveArticleBody may hydrate tunneled images to process-local blob: URLs.
    // A durable offline body must never persist those ephemeral addresses.
    html: makePortableBodyHtml(resolved.contentHtml),
    bodySource: resolved.bodySource,
  })
  return { id: article.id, entry }
}

/**
 * 严格按当前预设的分类/信源顺序同步。信源之间串行；只有当前信源的正文并发 2。
 * 每完成一个信源就提交一次检查点（含断点游标），因此前台抢占、切后台或网络抖动
 * 造成的中断只会丢掉当前信源的未完成部分，下次从游标继续而不是从 0 重来。
 */
export async function syncPrestore(options: SyncOptions): Promise<PrestoreSyncResult> {
  const { plan, signal, extraSources } = options
  const perSourceLimit = Math.max(1, Math.floor(options.perSourceLimit))
  const previous = await loadPrestoreManifest()
  const seed = seedPrestoreWindows<PrestoreArticleEntry>(plan, previous, perSourceLimit)
  const nextArticles = seed.articles
  const nextSources: PrestoreManifest['sources'] = seed.sources

  const resumed = resumableVisitedSources(previous?.sync, plan, perSourceLimit)
  const visited: string[] = []
  let committed = previous
  let syncedSources = 0
  let failedSources = 0
  let failedBodies = 0
  let completedSources = 0
  // 上一轮中断处的信源可能已有正文落盘但没进清单；只在本轮首个真正处理的信源上
  // 尝试认领，避免其余信源为必然落空的查找付出读盘开销。
  let claimOrphans = true
  const candidateLimit = prestoreCandidateLimit(perSourceLimit)

  const buildManifest = (cursor: PrestoreSyncCursor | null): PrestoreManifest => ({
    version: 1,
    revision: (committed?.revision ?? 0) + 1,
    presetId: plan.presetId,
    planKey: plan.key,
    perSourceLimit,
    // updatedAt 表示“上一次完整跑完”，检查点不能把未完成的一轮伪装成已完成。
    updatedAt: cursor ? committed?.updatedAt ?? 0 : Date.now(),
    sync: cursor,
    sources: { ...nextSources },
    articles: { ...nextArticles },
  })

  const checkpoint = async () => {
    const manifest = buildManifest({
      planKey: plan.key,
      presetId: plan.presetId,
      perSourceLimit,
      visitedSourceIds: [...visited],
      updatedAt: Date.now(),
    })
    try {
      await commitPrestoreManifest(manifest, { cleanupOrphans: false })
      committed = manifest
    } catch (error) {
      log.storage.warn('Prestore checkpoint failed', manifest.revision, error)
    }
  }

  for (let sourceIndex = 0; sourceIndex < plan.sources.length; sourceIndex += 1) {
    if (signal.aborted) throw abortError(signal)
    const target = plan.sources[sourceIndex]

    if (resumed.has(target.source.id)) {
      visited.push(target.source.id)
      completedSources += 1
      continue
    }

    emitProgress(
      options,
      target,
      sourceIndex,
      'listing',
      0,
      completedSources,
      failedBodies,
      failedSources,
    )

    let candidates: Article[]
    try {
      candidates = await fetchSourcePrestoreCandidates(target.source, candidateLimit, signal)
      if (signal.aborted) throw abortError(signal)
      syncedSources += 1
    } catch (error) {
      if (signal.aborted) throw abortError(signal)
      failedSources += 1
      completedSources += 1
      visited.push(target.source.id)
      log.storage.warn('Prestore source list failed', target.source.id, error)
      // 沿用铺底的上一轮窗口即可，没有新进展需要落盘。
      // 失败也记进游标：续传要继续往前走，死源留给下一轮整体重试。
      emitProgress(
        options,
        target,
        sourceIndex,
        'source-complete',
        nextSources[target.source.id]?.articleIds.length ?? 0,
        completedSources,
        failedBodies,
        failedSources,
      )
      continue
    }

    const freshIds: string[] = []
    let storedNew = 0
    for (
      let offset = 0;
      offset < candidates.length && freshIds.length < perSourceLimit;
      offset += BODY_CONCURRENCY
    ) {
      if (signal.aborted) throw abortError(signal)
      const batch = candidates.slice(offset, offset + BODY_CONCURRENCY)
      const results = await mapConcurrent(
        batch,
        BODY_CONCURRENCY,
        async (article) => {
          try {
            return await prepareBody(
              article,
              previous,
              nextArticles,
              signal,
              claimOrphans,
              extraSources,
            )
          } catch (error) {
            if (signal.aborted) throw abortError(signal)
            failedBodies += 1
            log.storage.debug('Prestore body failed', article.id, error)
            return null
          }
        },
        signal,
      )

      for (const result of results) {
        if (!result || freshIds.length >= perSourceLimit) continue
        if (!nextArticles[result.id]) storedNew += 1
        nextArticles[result.id] = result.entry
        freshIds.push(result.id)
      }

      emitProgress(
        options,
        target,
        sourceIndex,
        'bodies',
        freshIds.length,
        completedSources,
        failedBodies,
        failedSources,
      )
    }
    claimOrphans = false

    const previousIds = (previous?.sources[target.source.id]?.articleIds ?? []).filter(
      (id) => Boolean(previous?.articles[id]),
    )
    const retainedIds = mergeRollingWindow(freshIds, previousIds, perSourceLimit)
    for (const id of retainedIds) {
      if (nextArticles[id]) continue
      const entry = previous?.articles[id]
      if (entry) nextArticles[id] = entry
    }
    if (retainedIds.length) {
      nextSources[target.source.id] = {
        categoryId: target.categoryId,
        articleIds: retainedIds,
      }
    } else {
      delete nextSources[target.source.id]
    }

    completedSources += 1
    visited.push(target.source.id)
    emitProgress(
      options,
      target,
      sourceIndex,
      'source-complete',
      retainedIds.length,
      completedSources,
      failedBodies,
      failedSources,
    )

    // 只有真正写入了新正文才值得落一次检查点，避免全靠沿用时反复重写大清单。
    if (storedNew > 0 && sourceIndex < plan.sources.length - 1) await checkpoint()
  }

  if (signal.aborted) throw abortError(signal)

  // 完全失败或一篇可用正文都没有时，绝不能用空清单覆盖上一轮通勤内容。
  if ((syncedSources === 0 && resumed.size === 0) || Object.keys(nextArticles).length === 0) {
    return { manifest: committed, syncedSources, failedSources, failedBodies }
  }

  const manifest = buildManifest(null)
  await commitPrestoreManifest(manifest)
  return { manifest, syncedSources, failedSources, failedBodies }
}
