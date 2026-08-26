import { useEffect, useMemo, useRef, useState } from 'react'

import { log } from '../../lib/logger'
import { cleanOpenAiTranslation } from './openai'
import { normalizeChineseVariant } from './chineseVariant'
import {
  loadCachedFeedTranslations,
  saveCachedFeedTranslations,
} from './feedTranslationStorage'
import { createTranslationProvider } from './providers'
import { isTranslationRateLimitError } from './rateLimit'
import { isArticleForeign, isValidTranslationQuality } from './quality'
import type { Article } from '../../lib/types'
import {
  isLocalTranslationProviderId,
  type TranslatedFeedItem,
  type TranslationPrefs,
} from './types'

export { isArticleForeign }

const BATCH_SIZE = 8

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

    // 筛选出：属于外文、尚未有译文、且未在当前会话失败的待翻译文章
    const neededArticles: Article[] = []
    for (let i = 0; i < articles.length; i += 1) {
      const art = articles[i]
      if (
        translationsRef.current.has(art.id) &&
        translationsRef.current.get(art.id)?.targetLanguage === targetLanguage
      ) {
        continue
      }
      if (failedIdsRef.current.has(art.id)) {
        continue
      }
      if (isArticleForeign(art, targetLanguage)) {
        neededArticles.push(art)
      }
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
      : prefs.cloud[prefs.provider]
    const provider = createTranslationProvider(prefs.provider, config)

    const applyProgressiveUpdate = (art: Article, rawText: string) => {
      if (!art || !rawText) return
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
      saveCachedFeedTranslations([item])
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
                if (controller.signal.aborted) return
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
            // 命中限流：立即停止本轮管道，避免继续冲击接口导致封禁延长；
            // 未翻译条目不记失败，留待下次列表变化时自然重试
            if (isTranslationRateLimitError(chunkError)) break
            for (const art of chunk) {
              failedIdsRef.current.add(art.id)
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
