import { useEffect, useMemo, useRef, useState } from 'react'

import { log } from '../../lib/logger'
import { resolveAiFeatureConfig } from './aiConfig'
import { cleanOpenAiTranslation } from './openai'
import { normalizeChineseVariant } from './chineseVariant'
import {
  loadCachedFeedTranslation,
  loadCachedFeedTranslations,
  saveCachedFeedTranslations,
} from './feedTranslationStorage'
import { createTranslationProvider } from './providers'
import { isArticleForeign, isValidTranslationQuality } from './quality'
import type { Article } from '../../lib/types'
import {
  isLocalTranslationProviderId,
  type TranslatedFeedItem,
  type TranslationLanguage,
  type TranslationPrefs,
} from './types'

export { isArticleForeign }

const BATCH_SIZE = 8

/**
 * 从当前列表挑出真正需要联网翻译的条目。
 * 已在内存状态、会话内失败或非外文的先跳过；剩下的再查持久缓存——
 * React 状态合并是异步的，缓存合并 effect 的 setState 落地前管道 effect 就会执行，
 * 不查缓存会把 localStorage 里已有译文（含上一轮被中断时落盘的结果）重新交给翻译 API。
 */
export function collectFeedTranslationWork(
  articles: Article[],
  translated: ReadonlyMap<string, TranslatedFeedItem>,
  failedIds: ReadonlySet<string>,
  targetLanguage: TranslationLanguage,
): { needed: Article[]; cachedHits: TranslatedFeedItem[] } {
  const needed: Article[] = []
  const cachedHits: TranslatedFeedItem[] = []
  for (let i = 0; i < articles.length; i += 1) {
    const art = articles[i]
    if (translated.get(art.id)?.targetLanguage === targetLanguage) continue
    if (failedIds.has(art.id)) continue
    if (!isArticleForeign(art, targetLanguage)) continue
    const cached = loadCachedFeedTranslation(art.id, targetLanguage)
    if (cached) {
      cachedHits.push(cached)
      continue
    }
    needed.push(art)
  }
  return { needed, cachedHits }
}

export function useFeedTranslation(
  articles: Article[],
  prefs: TranslationPrefs,
  options?: {
    enabled?: boolean
  },
) {
  const enabled = options?.enabled ?? prefs.translateFeed !== false
  const targetLanguage = prefs.targetLanguage
  const [translations, setTranslations] = useState<Map<string, TranslatedFeedItem>>(() =>
    enabled
      ? loadCachedFeedTranslations(
          articles.map((a) => a.id),
          targetLanguage,
        )
      : new Map(),
  )
  const [isTranslating, setIsTranslating] = useState(false)
  const pendingAbortRef = useRef<AbortController | null>(null)
  const translationsRef = useRef(translations)
  translationsRef.current = translations
  const failedIdsRef = useRef<Set<string>>(new Set())

  // 当 targetLanguage 或 enabled 变动时，清理会话级失败记录
  useEffect(() => {
    failedIdsRef.current.clear()
  }, [targetLanguage, enabled, prefs.provider])

  // 当 articles 或 targetLanguage 发生变动时，先同步从缓存加载已存在的译文
  useEffect(() => {
    if (!enabled) {
      setTranslations(new Map())
      setIsTranslating(false)
      pendingAbortRef.current?.abort()
      return
    }
    if (!articles.length) return
    const ids = articles.map((a) => a.id)
    const cached = loadCachedFeedTranslations(ids, targetLanguage)
    setTranslations((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const [id, item] of cached.entries()) {
        if (!next.has(id) || next.get(id)?.targetLanguage !== targetLanguage) {
          next.set(id, item)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [articles, targetLanguage, enabled])

  // 后台持续、逐批对当前列表里尚未翻译的外文文章执行批量翻译管道（全列表覆盖，不因单批结束而截断）
  useEffect(() => {
    if (!enabled || !articles.length) {
      setIsTranslating(false)
      return
    }

    // 筛选出：属于外文、尚未有译文（状态或持久缓存）、且未在当前会话失败的待翻译文章
    const { needed: neededArticles, cachedHits } = collectFeedTranslationWork(
      articles,
      translationsRef.current,
      failedIdsRef.current,
      targetLanguage,
    )

    if (cachedHits.length) {
      setTranslations((prev) => {
        const next = new Map(prev)
        for (const item of cachedHits) next.set(item.articleId, item)
        return next
      })
    }

    if (!neededArticles.length) {
      setIsTranslating(false)
      return
    }

    pendingAbortRef.current?.abort()
    const controller = new AbortController()
    pendingAbortRef.current = controller
    setIsTranslating(true)

    const config = isLocalTranslationProviderId(prefs.provider)
      ? undefined
      : prefs.provider === 'openai'
        ? resolveAiFeatureConfig(prefs, 'translation')
        : prefs.cloud[prefs.provider]
    const provider = createTranslationProvider(prefs.provider, config)

    /** 本轮已处理过的条目，避免 onBatch 与最终结果循环对同一译文双重校验与写入 */
    const appliedIds = new Set<string>()

    const applyProgressiveUpdate = (art: Article, rawText: string) => {
      if (!art || !rawText || appliedIds.has(art.id)) return
      appliedIds.add(art.id)
      const trimmed = cleanOpenAiTranslation(rawText)

      // 质量与完整性校验：拦截严重残缺、中英混乱或翻译直通失败
      if (!isValidTranslationQuality(art.title, trimmed, targetLanguage)) {
        failedIdsRef.current.add(art.id)
        return
      }

      const normalizedTitle = normalizeChineseVariant(trimmed, targetLanguage)
      if (!normalizedTitle) return

      const item: TranslatedFeedItem = {
        articleId: art.id,
        title: normalizedTitle,
        targetLanguage,
        translatedAt: Date.now(),
      }
      // 即使本轮已被取消也把有效译文落盘：重启的管道据缓存跳过，不再重复请求同一标题
      saveCachedFeedTranslations([item])
      if (controller.signal.aborted) return
      setTranslations((prev) => {
        const next = new Map(prev)
        next.set(art.id, item)
        return next
      })
    }

    const runPipeline = async () => {
      try {
        // 分批连续处理整个列表中的所有外文条目
        for (let chunkIdx = 0; chunkIdx < neededArticles.length; chunkIdx += BATCH_SIZE) {
          if (controller.signal.aborted) break
          const chunk = neededArticles.slice(chunkIdx, chunkIdx + BATCH_SIZE)
          const textsToTranslate = chunk.map((a) => a.title.trim())

          try {
            const results = await provider.translate({
              texts: textsToTranslate,
              sourceLanguage: prefs.sourceLanguage,
              targetLanguage: prefs.targetLanguage,
              signal: controller.signal,
              onBatch: (batchTranslations, startIndex) => {
                for (let i = 0; i < batchTranslations.length; i += 1) {
                  const art = chunk[startIndex + i]
                  const transText = batchTranslations[i]
                  if (art && transText) {
                    applyProgressiveUpdate(art, transText)
                  }
                }
              },
            })

            if (controller.signal.aborted) break
            for (let i = 0; i < results.length; i += 1) {
              const art = chunk[i]
              const transText = results[i]
              if (art && transText) {
                applyProgressiveUpdate(art, transText)
              }
            }
          } catch (chunkError) {
            if (controller.signal.aborted) break
            log.translation.warn('Failed to translate chunk:', chunkError)
            for (const art of chunk) {
              // 批内已成功落地的条目不算失败，保留后续会话重用缓存的资格
              if (!appliedIds.has(art.id)) failedIdsRef.current.add(art.id)
            }
          }
        }
      } finally {
        if (pendingAbortRef.current === controller) {
          setIsTranslating(false)
          pendingAbortRef.current = null
        }
      }
    }

    void runPipeline()

    return () => {
      controller.abort()
      if (pendingAbortRef.current === controller) {
        pendingAbortRef.current = null
      }
    }
  }, [articles, targetLanguage, prefs, enabled])

  return useMemo(
    () => ({
      translations,
      isTranslating,
      enabled,
    }),
    [translations, isTranslating, enabled],
  )
}
