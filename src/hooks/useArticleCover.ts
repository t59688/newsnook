import { useEffect, useRef, useState } from 'react'

import { articleCoverUrl } from '../lib/articleAudio'
import { recoverArticleCover } from '../lib/articleCoverRecovery'
import type { Article } from '../lib/types'

type Recovery = {
  articleId: string
  original: string
  status: 'recovering' | 'ready' | 'failed'
  replacement?: string
}

export interface UseArticleCoverOptions {
  /** 无初始封面图时，按需从正文缓存/文章页恢复一张可用封面（用于关注收件箱等需要统一封面的列表）。 */
  recoverMissing?: boolean
  /** 首次为缺图条目找到封面时回调，便于同步回本地列表存储。 */
  onResolved?: (article: Article, imageUrl: string) => void
}

/** 只在图片彻底失败（或显式启用缺图补救）时寻找替代图；同一缩略图最多尝试一张替代图。 */
export function useArticleCover(article: Article, options: UseArticleCoverOptions = {}) {
  const { recoverMissing = false, onResolved } = options
  const original = articleCoverUrl(article.image)
  const originalKey = original ?? ''
  const [recovery, setRecovery] = useState<Recovery | null>(null)
  const current = recovery && recovery.articleId === article.id && recovery.original === originalKey
    ? recovery
    : null
  const cover = current?.status === 'failed' ? undefined : current?.replacement ?? original

  const articleRef = useRef(article)
  const onResolvedRef = useRef(onResolved)
  const settledMissingRef = useRef<string | null>(null)
  useEffect(() => {
    articleRef.current = article
    onResolvedRef.current = onResolved
  })

  useEffect(() => {
    if (!recoverMissing || original || !article.originUrl) return
    const attemptKey = `${article.id}:${article.originUrl}`
    if (settledMissingRef.current === attemptKey) return

    let cancelled = false
    void recoverArticleCover(articleRef.current, '').then((replacement) => {
      if (cancelled) return
      settledMissingRef.current = attemptKey
      setRecovery((previous) => {
        if (previous && (previous.articleId !== article.id || previous.original !== '')) {
          return previous
        }
        return {
          articleId: article.id,
          original: '',
          status: replacement ? 'ready' : 'failed',
          replacement,
        }
      })
      if (replacement) {
        onResolvedRef.current?.(articleRef.current, replacement)
      }
    })

    return () => {
      cancelled = true
    }
  }, [article.id, article.originUrl, original, recoverMissing])

  const onFailed = () => {
    if (current) {
      if (current.status === 'ready') {
        setRecovery({ articleId: article.id, original: originalKey, status: 'failed' })
      }
      return
    }
    if (!original) return

    setRecovery({ articleId: article.id, original: originalKey, status: 'recovering' })
    void recoverArticleCover(article, original).then((replacement) => {
      setRecovery((previous) => (
        !previous || (previous.articleId === article.id && previous.original === originalKey)
          ? {
              articleId: article.id,
              original: originalKey,
              status: replacement ? 'ready' : 'failed',
              replacement,
            }
          : previous
      ))
    })
  }

  return {
    cover,
    hasOriginal: Boolean(original),
    failed: current?.status === 'failed',
    onFailed,
  }
}
