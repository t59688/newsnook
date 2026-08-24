import { memo, useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type RefObject } from 'react'
import { Browser } from '@capacitor/browser'
import { Capacitor } from '@capacitor/core'
import { ArrowLeft, BookmarkCheck, BookmarkPlus, Globe, Languages, LoaderCircle, MessageSquare, MoreHorizontal, RefreshCw, X } from 'lucide-react'

import { ImageLightbox } from '../components/ImageLightbox'
import { EinkReaderMenu } from '../components/EinkReaderMenu'
import { ReaderMoreMenu } from '../components/ReaderMoreMenu'
import { ShareArticleSheet } from '../components/ShareArticleSheet'
import { InkAudioPlayer } from '../components/InkAudioPlayer'
import { InkImage } from '../components/InkImage'
import { InkVideoPlayer } from '../components/InkVideoPlayer'
import { InlineArticleAudio } from '../components/InlineArticleAudio'
import { InlineArticleVideos, VideoSniffPlaceholder } from '../components/InlineArticleVideos'
import { InlineYoutubeEmbeds } from '../components/InlineYoutubeEmbeds'
import {
  OriginPlayerSurface,
  type OriginPlayerCloseHandle,
} from '../components/OriginPlayerSurface'
import { shouldUseOriginPlayerSurface } from '../features/mediaSniffer/originPlayerGate'
import { loadPrestoredBody } from '../features/prestore/store'
import { loadCachedBody, saveCachedBody } from '../lib/bodyCache'
import { addVolumePageTurnListener, setVolumePageTurnEnabled } from '../lib/volumePageTurn'
import { useEdgeSwipeBack } from '../hooks/useEdgeSwipeBack'
import { useNetworkStatus } from '../hooks/useNetworkStatus'
import { usePagedReader } from '../hooks/usePagedReader'
import { useProgressiveImages } from '../hooks/useProgressiveImages'
import { useReaderFontPinch } from '../hooks/useReaderFontPinch'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { revokeBlobUrl } from '../features/proxy/hydrateImages'
import { deferMediaInHtml, DEFERRED_SRC_ATTR, type DeferredHostPhase } from '../lib/deferReaderMedia'
import { stageYoutubeEmbedsInHtml } from '../lib/youtubeEmbeds'
import { shouldAutoLoadMedia } from '../lib/mediaLoadPolicy'
import { revealReader } from '../lib/motion'
import {
  flushReadingPositions,
  forgetReadingPosition,
  readingPositionOf,
  rememberReadingPosition,
  resolveScrollTop,
} from '../lib/readingPosition'
import { buildClipboardText, copyShareText, shareArticle } from '../lib/shareArticle'
import {
  SHARE_FALLBACK_TITLE,
  buildShareUrl,
  isPendingShareTitle,
  sharePayloadFromArticle,
  withResolvedShareTitle,
} from '../lib/shareLink'
import { resolveArticleBody, type BodySource } from '../lib/resolveBody'
import { articleCoverUrl } from '../lib/articleAudio'
import { articleRelativeTime } from '../lib/time'
import type { Article } from '../lib/types'
import type { TypographyPrefs } from '../sources/preferences'
import { createTranslationService } from '../features/translation/service'
import {
  translationDisplayModeLabel,
  translationLanguageLabel,
  translationProviderLabel,
} from '../features/translation/config'
import type { TranslatedArticleContent, TranslationPrefs } from '../features/translation/types'
import { fetchCommentCount, supportsComments } from '../features/comments/service'
import { CommentsDrawer } from '../features/comments/components/CommentsDrawer'
import { articleFromRelatedLink } from '../features/catalogEngine/toArticles'
import type { NewsSource } from '../sources/registry'
import type { InkVideoPlayerFullscreenHandle } from '../components/InkVideoPlayer'

interface Props {
  article: Article
  saved: boolean
  onClose: () => void
  onToggleLater: (article: Article) => void
  onCacheChange: () => void
  /** 返回 true 表示已消费系统返回（例如关闭大图），供 App 回退栈使用 */
  overlayCloserRef?: MutableRefObject<(() => boolean) | null>
  translationPrefs: TranslationPrefs
  customSources?: NewsSource[]
  /** 墨水屏模式：分页阅读；false/缺省时保持滚动阅读 */
  einkMode?: boolean
  /** 当前正文字号倍率（墨水屏菜单调节） */
  fontScale?: number
  onTypographyChange?: (patch: Partial<TypographyPrefs>) => void
  /** 墨水屏菜单「设置」：打开应用设置并保留返回阅读 */
  onOpenSettings?: () => void
  /** 详情页相关卡片：站内打开，不跳出阅读器 */
  onOpenRelated?: (article: Article) => void
  /** Android：仅 Wi-Fi 自动加载阅读页媒体 */
  wifiOnlyAutoLoadMedia?: boolean
}

type LoadState = 'loading' | 'ready' | 'error'
const TRANSLATION_TIMEOUT_MS = 60_000

export function ReaderScreen({
  article,
  saved,
  onClose,
  onToggleLater,
  onCacheChange,
  overlayCloserRef,
  translationPrefs,
  customSources,
  einkMode = false,
  fontScale = 1,
  onTypographyChange,
  onOpenSettings,
  onOpenRelated,
  wifiOnlyAutoLoadMedia = false,
}: Props) {
  const reduced = useReducedMotion()
  const { connectionType } = useNetworkStatus()
  const shellRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const proseRef = useRef<HTMLDivElement>(null)
  const contentMeasureRef = useRef<HTMLDivElement>(null)
  const prevEinkRef = useRef(einkMode)
  const videoFullscreenRef = useRef<InkVideoPlayerFullscreenHandle | null>(null)
  const originPlayerCloseRef = useRef<OriginPlayerCloseHandle | null>(null)
  const useOriginSurface = shouldUseOriginPlayerSurface({
    sourceId: article.sourceId,
    contentType: article.contentType,
  })
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [html, setHtml] = useState('')
  const [bodySource, setBodySource] = useState<BodySource | null>(null)
  const [resolvedOriginUrl, setResolvedOriginUrl] = useState<string | undefined>()
  const [resolvedTitle, setResolvedTitle] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [fromCache, setFromCache] = useState(false)
  const [retryToken, setRetryToken] = useState(0)
  const [unlockedMediaUrls, setUnlockedMediaUrls] = useState<string[]>([])
  const [mediaPlayables, setMediaPlayables] = useState<Record<string, string>>({})
  const mediaPlayablesRef = useRef(mediaPlayables)
  mediaPlayablesRef.current = mediaPlayables
  const [deferredPhases, setDeferredPhases] = useState<Record<string, DeferredHostPhase>>({})
  const [lightbox, setLightbox] = useState<{ src: string; alt: string } | null>(null)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [commentCount, setCommentCount] = useState<number | undefined>()
  const [translated, setTranslated] = useState<TranslatedArticleContent | null>(null)
  const [showTranslation, setShowTranslation] = useState(false)
  const [translationState, setTranslationState] = useState<'idle' | 'loading' | 'error'>('idle')
  const [translationError, setTranslationError] = useState('')
  const translationAbortRef = useRef<AbortController | null>(null)
  const translationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingPartialRef = useRef<TranslatedArticleContent | null>(null)
  const partialFrameRef = useRef(0)
  const canComment = useMemo(
    () => supportsComments({ ...article, originUrl: resolvedOriginUrl || article.originUrl }),
    [article, resolvedOriginUrl],
  )

  useEffect(() => {
    if (!canComment) return
    const controller = new AbortController()
    void fetchCommentCount(
      { ...article, originUrl: resolvedOriginUrl || article.originUrl },
      controller.signal,
    ).then((count) => {
      if (typeof count === 'number') {
        setCommentCount(count)
      }
    })
    return () => controller.abort()
  }, [article, resolvedOriginUrl, canComment])

  const [pillVisible, setPillVisible] = useState(true)
  const [chromeVisible, setChromeVisible] = useState(true)
  const [einkMenuOpen, setEinkMenuOpen] = useState(false)
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [shareSheetOpen, setShareSheetOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [resumedPosition, setResumedPosition] = useState(false)
  const lastScrollTopRef = useRef(0)
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const scrollRafRef = useRef(0)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** 已为哪篇文章恢复过位置，避免重排或重新测量时把人反复弹回去 */
  const restoredForRef = useRef<string | null>(null)

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    toastTimerRef.current = setTimeout(() => setToast(null), 2200)
  }, [])

  useEffect(
    () => () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (!resumedPosition) return
    const timer = setTimeout(() => setResumedPosition(false), 5000)
    return () => clearTimeout(timer)
  }, [resumedPosition])

  const pinchEnabled =
    !einkMode && loadState === 'ready' && !lightbox && !commentsOpen

  const { hudLabel } = useReaderFontPinch({
    targetRef: rootRef,
    fontScale,
    enabled: pinchEnabled,
    onCommit: (next) => onTypographyChange?.({ fontScale: next }),
  })

  // 返回键：视频全屏时先退出全屏（回到文章页），而不是直接关闭文章
  useEffect(() => {
    if (!overlayCloserRef) return
    const prev = overlayCloserRef.current
    overlayCloserRef.current = () => {
      if (originPlayerCloseRef.current?.closeCustom()) return true
      const handle = videoFullscreenRef.current
      if (handle?.immersive) {
        handle.exit()
        return true
      }
      return prev ? prev() : false
    }
    return () => {
      overlayCloserRef.current = prev
    }
  }, [overlayCloserRef])

  useEffect(() => {
    if (!overlayCloserRef) return
    if (shareSheetOpen) {
      const prev = overlayCloserRef.current
      overlayCloserRef.current = () => {
        setShareSheetOpen(false)
        return true
      }
      return () => {
        overlayCloserRef.current = prev
      }
    }
    if (einkMenuOpen) {
      const prev = overlayCloserRef.current
      overlayCloserRef.current = () => {
        setEinkMenuOpen(false)
        return true
      }
      return () => {
        overlayCloserRef.current = prev
      }
    }
    if (moreMenuOpen) {
      const prev = overlayCloserRef.current
      overlayCloserRef.current = () => {
        setMoreMenuOpen(false)
        return true
      }
      return () => {
        overlayCloserRef.current = prev
      }
    }
    if (commentsOpen) {
      const prev = overlayCloserRef.current
      overlayCloserRef.current = () => {
        setCommentsOpen(false)
        return true
      }
      return () => {
        overlayCloserRef.current = prev
      }
    }
  }, [commentsOpen, einkMenuOpen, moreMenuOpen, overlayCloserRef, shareSheetOpen])

  const handleScroll = useCallback(() => {
    if (einkMode) return
    if (scrollRafRef.current) return
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = 0
      const el = rootRef.current
      if (!el) return
      const currentScrollTop = el.scrollTop
      const delta = currentScrollTop - lastScrollTopRef.current

      if (currentScrollTop < 50 || delta < -8) {
        setPillVisible(true)
      } else if (delta > 15 && currentScrollTop > 80) {
        setPillVisible(false)
      }
      lastScrollTopRef.current = currentScrollTop

      // 位置记忆只更新内存表，落盘由 readingPosition 自行节流
      if (restoredForRef.current === article.id) {
        rememberReadingPosition(article.id, {
          scrollTop: currentScrollTop,
          scrollRange: Math.max(el.scrollHeight - el.clientHeight, 0),
        })
      }
    })

    if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    scrollTimeoutRef.current = setTimeout(() => {
      setPillVisible(true)
    }, 450)
  }, [article.id, einkMode])

  useEffect(() => {
    return () => {
      if (scrollRafRef.current) {
        window.cancelAnimationFrame(scrollRafRef.current)
      }
      if (scrollTimeoutRef.current) {
        clearTimeout(scrollTimeoutRef.current)
      }
      flushReadingPositions()
    }
  }, [])

  useEffect(() => {
    restoredForRef.current = null
    setResumedPosition(false)
    setMoreMenuOpen(false)
  }, [article.id])

  /**
   * 跨会话恢复滚动位置：正文就绪后内容高度还会随图片加载增长，
   * 这里轮询几次直到可滚动区域出现，再按比例落回上次读到的位置。
   */
  useEffect(() => {
    if (einkMode || loadState !== 'ready') return
    if (restoredForRef.current === article.id) return

    const position = readingPositionOf(article.id)
    if (!position || position.scrollTop <= 0) {
      restoredForRef.current = article.id
      return
    }

    let attempts = 0
    let timer: ReturnType<typeof setTimeout> | null = null

    const attempt = () => {
      timer = null
      const el = rootRef.current
      if (!el || restoredForRef.current === article.id) return

      // 用户已经自己滚起来了就别再抢位置
      if (el.scrollTop > 8) {
        restoredForRef.current = article.id
        return
      }

      const range = Math.max(el.scrollHeight - el.clientHeight, 0)
      const target = range > 0 ? resolveScrollTop(position, range) : 0
      if (target > 0) {
        el.scrollTop = target
        lastScrollTopRef.current = target
        restoredForRef.current = article.id
        setResumedPosition(true)
        return
      }

      attempts += 1
      if (attempts < 12) timer = setTimeout(attempt, 140)
      else restoredForRef.current = article.id
    }

    attempt()
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [article.id, einkMode, html.length, loadState])

  // 屏幕右侧边缘向左滑动手势拉出跟贴
  useEffect(() => {
    const element = shellRef.current
    if (!element || !canComment || commentsOpen || lightbox) return

    let startX = 0
    let startY = 0
    let isTracking = false

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const touch = e.touches[0]
      if (window.innerWidth - touch.clientX <= 38) {
        startX = touch.clientX
        startY = touch.clientY
        isTracking = true
      }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!isTracking || e.touches.length !== 1) return
      const touch = e.touches[0]
      const deltaX = touch.clientX - startX
      const deltaY = touch.clientY - startY

      if (Math.abs(deltaY) > Math.abs(deltaX) * 1.5 && Math.abs(deltaY) > 15) {
        isTracking = false
      }
    }

    const onTouchEnd = (e: TouchEvent) => {
      if (!isTracking) return
      isTracking = false
      const touch = e.changedTouches[0]
      const deltaX = touch.clientX - startX
      const deltaY = touch.clientY - startY

      if (deltaX <= -36 && Math.abs(deltaX) > Math.abs(deltaY) * 1.1) {
        setCommentsOpen(true)
      }
    }

    element.addEventListener('touchstart', onTouchStart, { passive: true })
    element.addEventListener('touchmove', onTouchMove, { passive: true })
    element.addEventListener('touchend', onTouchEnd, { passive: true })

    return () => {
      element.removeEventListener('touchstart', onTouchStart)
      element.removeEventListener('touchmove', onTouchMove)
      element.removeEventListener('touchend', onTouchEnd)
    }
  }, [canComment, commentsOpen, lightbox])

  useEdgeSwipeBack({
    containerRef: shellRef,
    onBack: onClose,
    disabled: Boolean(lightbox || commentsOpen || einkMenuOpen || moreMenuOpen || shareSheetOpen),
    reduced,
  })

  useEffect(() => {
    const root = proseRef.current
    if (!root || loadState !== 'ready') return

    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      const relatedLink = target.closest('a[data-reader-role="related-item"]')
      if (relatedLink instanceof HTMLAnchorElement) {
        const href = relatedLink.href
        if (href && onOpenRelated) {
          event.preventDefault()
          event.stopPropagation()
          const title =
            relatedLink.getAttribute('data-related-title') ||
            relatedLink.textContent?.replace(/\s+/g, ' ').trim() ||
            href
          const img = relatedLink.querySelector('img')
          onOpenRelated(
            articleFromRelatedLink(
              article,
              href,
              title,
              img?.currentSrc || img?.getAttribute('src') || undefined,
            ),
          )
        }
        return
      }
      if (einkMode) return
      if (!(target instanceof HTMLImageElement)) return
      if (target.classList.contains('async-img-failed')) return
      if (target.getAttribute(DEFERRED_SRC_ATTR) && !target.getAttribute('src')) return
      if (target.closest('[data-reader-deferred]')) return
      if (
        target.classList.contains('reader-img-badge') ||
        target.getAttribute('data-reader-role') === 'badge'
      ) {
        return
      }
      const src = target.currentSrc || target.src
      if (!src) return
      event.preventDefault()
      setLightbox({ src, alt: target.alt || '' })
    }

    root.addEventListener('click', onClick)
    return () => root.removeEventListener('click', onClick)
  }, [article, einkMode, html, loadState, onOpenRelated, showTranslation, translated])

  useEffect(() => {
    setUnlockedMediaUrls([])
    setMediaPlayables((prev) => {
      for (const value of Object.values(prev)) revokeBlobUrl(value)
      return {}
    })
    setDeferredPhases({})
  }, [article.id])

  useEffect(() => {
    return () => {
      for (const value of Object.values(mediaPlayablesRef.current)) revokeBlobUrl(value)
    }
  }, [])

  useEffect(() => {
    translationAbortRef.current?.abort()
    translationAbortRef.current = null
    if (translationTimeoutRef.current) clearTimeout(translationTimeoutRef.current)
    translationTimeoutRef.current = null
    setTranslated(null)
    setShowTranslation(false)
    setTranslationState('idle')
    setTranslationError('')
  }, [
    article.id,
    translationPrefs.displayMode,
    translationPrefs.provider,
    translationPrefs.sourceLanguage,
    translationPrefs.targetLanguage,
  ])

  useEffect(
    () => () => {
      translationAbortRef.current?.abort()
      if (translationTimeoutRef.current) clearTimeout(translationTimeoutRef.current)
    },
    [],
  )

  useEffect(() => {
    const controller = new AbortController()
    setError(null)

    // 正文内容是静态的，命中缓存直接出，断网也能重读；重新抽取时才绕过
    if (retryToken === 0 && article.contentType !== 'video') {
      const cached = loadCachedBody(article.id)
      if (cached) {
        setHtml(cached.html)
        setBodySource(cached.bodySource)
        setFromCache(true)
        setLoadState('ready')
        if (!cached.article) {
          saveCachedBody(article, {
            html: cached.html,
            bodySource: cached.bodySource,
          })
        }
        onCacheChange()
        return () => controller.abort()
      }
    }

    setLoadState('loading')
    setHtml('')
    setBodySource(null)
    setResolvedOriginUrl(undefined)
    setResolvedTitle(undefined)
    setFromCache(false)

    const loadFromNetwork = () => {
      void resolveArticleBody(
        retryToken > 0 && article.videoUrl
          ? { ...article, videoUrl: undefined }
          : article,
        controller.signal,
        customSources,
        (resolved) => {
          if (controller.signal.aborted) return
          // 正文与媒体嗅探分开：先显示抽取结果，播放器地址稍后增量补上。
          setHtml(resolved.contentHtml)
          setResolvedTitle(resolved.title)
          if (resolved.bodySource !== 'video') {
            const cached = saveCachedBody(withResolvedShareTitle(article, resolved.title), {
              html: resolved.contentHtml,
              bodySource: resolved.bodySource,
            })
            if (cached) onCacheChange()
          }
        },
      )
        .then((resolved) => {
          if (controller.signal.aborted) return
          setHtml(resolved.contentHtml)
          setBodySource(resolved.bodySource)
          setResolvedOriginUrl(resolved.resolvedOriginUrl)
          setResolvedTitle(resolved.title)
          setLoadState('ready')
          // 视频稿正文只是占位文案，缓存没有意义
          if (resolved.bodySource !== 'video') {
            const cached = saveCachedBody(withResolvedShareTitle(article, resolved.title), {
              html: resolved.contentHtml,
              bodySource: resolved.bodySource,
            })
            if (cached) onCacheChange()
          }
        })
        .catch((err: unknown) => {
          if (controller.signal.aborted) return
          setError(err instanceof Error ? err.message : '正文加载失败')
          setLoadState('error')
        })
    }

    // 普通正文热缓存优先保持同步首屏；未命中时再读持久预存，最后才联网。
    if (retryToken === 0 && article.contentType !== 'video') {
      void loadPrestoredBody(article.id).then((prestored) => {
        if (controller.signal.aborted) return
        if (prestored) {
          setHtml(prestored.html)
          setBodySource(prestored.bodySource)
          setFromCache(true)
          setLoadState('ready')
          return
        }
        loadFromNetwork()
      })
    } else {
      loadFromNetwork()
    }

    return () => controller.abort()
  }, [article, customSources, onCacheChange, retryToken])

  useEffect(() => {
    if (loadState === 'ready') {
      revealReader(rootRef.current, reduced)
    }
  }, [article.id, loadState, reduced])

  const displayedHtml = showTranslation && translated ? translated.html : html
  useEffect(() => {
    if (
      loadState !== 'ready' ||
      article.contentType !== 'video' ||
      article.videoUrl ||
      !/data-media-pending=["']sniffing["']/i.test(html)
    ) return
    const timer = setTimeout(() => {
      setHtml((current) => current.replace(
        /data-media-pending=["']sniffing["']/gi,
        'data-media-pending="failed"',
      ))
    }, 15_000)
    return () => clearTimeout(timer)
  }, [article.contentType, article.videoUrl, html, loadState])
  const coverUrl = articleCoverUrl(article.image)
  const autoLoadMedia = shouldAutoLoadMedia({
    wifiOnlyAutoLoadMedia: Boolean(wifiOnlyAutoLoadMedia),
    isNative: Capacitor.isNativePlatform(),
    connectionType,
  })
  const unlockedSet = useMemo(() => new Set(unlockedMediaUrls), [unlockedMediaUrls])
  const deferredPhaseMap = useMemo(
    () => new Map(Object.entries(deferredPhases) as Array<[string, DeferredHostPhase]>),
    [deferredPhases],
  )
  const playableSrcMap = useMemo(() => new Map(Object.entries(mediaPlayables)), [mediaPlayables])
  const proseHtml = useMemo(
    () => {
      const mediaHtml = autoLoadMedia
        ? displayedHtml
        : deferMediaInHtml(displayedHtml, unlockedSet, deferredPhaseMap, playableSrcMap)
      return stageYoutubeEmbedsInHtml(mediaHtml)
    },
    [autoLoadMedia, displayedHtml, unlockedSet, deferredPhaseMap, playableSrcMap],
  )
  const onDeferredPhase = useCallback(
    (url: string, phase: DeferredHostPhase | 'loaded', playableSrc?: string) => {
      if (phase === 'loaded') {
        setUnlockedMediaUrls((prev) => (prev.includes(url) ? prev : [...prev, url]))
        setMediaPlayables((prev) => ({ ...prev, [url]: playableSrc || url }))
        setDeferredPhases((prev) => {
          if (!(url in prev)) return prev
          const next = { ...prev }
          delete next[url]
          return next
        })
        return
      }
      setDeferredPhases((prev) => (prev[url] === phase ? prev : { ...prev, [url]: phase }))
    },
    [],
  )
  const onUnlockedMedia = useCallback((url: string) => {
    setUnlockedMediaUrls((prev) => (prev.includes(url) ? prev : [...prev, url]))
  }, [])
  const comparing = Boolean(
    showTranslation && translated && translationPrefs.displayMode === 'compare',
  )
  /** 分享深链没带标题，靠正文抽取补；抽取失败就换个中性说法，别一直显示占位 */
  const pendingTitle =
    isPendingShareTitle(article.title) && loadState === 'error'
      ? SHARE_FALLBACK_TITLE
      : article.title

  const displayedTitle =
    showTranslation && translated && !comparing
      ? translated.title
      : resolvedTitle || pendingTitle

  /** 分享深链进来的文章标题只是占位；收藏时存正文抽取补回的真标题 */
  const laterArticle = useMemo(
    () => withResolvedShareTitle(article, resolvedTitle),
    [article, resolvedTitle],
  )

  const paged = usePagedReader({
    enabled: einkMode,
    articleId: article.id,
    viewportRef: rootRef,
    contentRef: contentMeasureRef,
    measureKey: `${proseHtml.length}:${showTranslation}:${loadState}`,
    ready: loadState === 'ready',
  })

  const pagedGoPrevRef = useRef(paged.goPrev)
  const pagedGoNextRef = useRef(paged.goNext)
  const pagedHandleTapRef = useRef(paged.handleTap)
  const pagedSyncRef = useRef(paged.syncFromScrollTop)
  const pagedOffsetRef = useRef(paged.currentStartOffset)
  pagedGoPrevRef.current = paged.goPrev
  pagedGoNextRef.current = paged.goNext
  pagedHandleTapRef.current = paged.handleTap
  pagedSyncRef.current = paged.syncFromScrollTop
  pagedOffsetRef.current = paged.currentStartOffset

  const einkGateRef = useRef({ lightbox, commentsOpen, einkMenuOpen, moreMenuOpen, shareSheetOpen })
  einkGateRef.current = { lightbox, commentsOpen, einkMenuOpen, moreMenuOpen, shareSheetOpen }

  useEffect(() => {
    const wasEink = prevEinkRef.current
    if (wasEink === einkMode) return
    prevEinkRef.current = einkMode
    const el = rootRef.current
    if (!el) return

    if (!wasEink && einkMode) {
      const scrollTop = el.scrollTop
      requestAnimationFrame(() => {
        pagedSyncRef.current(scrollTop)
        if (rootRef.current) rootRef.current.scrollTop = 0
      })
      setChromeVisible(true)
      setEinkMenuOpen(false)
      return
    }
    if (wasEink && !einkMode) {
      el.scrollTop = pagedOffsetRef.current()
      setPillVisible(true)
      setEinkMenuOpen(false)
    }
  }, [einkMode])

  useEffect(() => {
    if (!einkMode) return
    const el = rootRef.current
    if (el) el.scrollTop = 0
  }, [einkMode, paged.pageIndex])

  // 墨水屏：捕获阶段处理分区，避免图片/InkImage 先打开大图
  useEffect(() => {
    if (!einkMode) return
    const el = rootRef.current
    if (!el) return

    const onCaptureClick = (event: MouseEvent) => {
      const gate = einkGateRef.current
      if (gate.lightbox || gate.commentsOpen || gate.einkMenuOpen || gate.moreMenuOpen || gate.shareSheetOpen) return
      const target = event.target
      if (!(target instanceof Element)) return

      const interactive = target.closest(
        'a[href], button, input, textarea, select, video, [data-no-page-tap]',
      )
      const isZoomImage = Boolean(target.closest('[aria-label="查看大图"]'))
      if (interactive && !isZoomImage) return

      event.preventDefault()
      event.stopPropagation()

      const rect = el.getBoundingClientRect()
      const zone = pagedHandleTapRef.current(event.clientX - rect.left, rect.width)
      if (zone === 'prev') pagedGoPrevRef.current()
      else if (zone === 'next') pagedGoNextRef.current()
      else setEinkMenuOpen(true)
    }

    el.addEventListener('click', onCaptureClick, true)
    return () => el.removeEventListener('click', onCaptureClick, true)
  }, [einkMode])

  // 墨水屏：音量键翻页（原生）+ 键盘方向键（Web/桌面）
  useEffect(() => {
    if (!einkMode) {
      void setVolumePageTurnEnabled(false)
      return
    }

    let cancelled = false
    let removeNative: (() => void) | undefined

    void setVolumePageTurnEnabled(true)
    void addVolumePageTurnListener((direction) => {
      const gate = einkGateRef.current
      if (gate.lightbox || gate.commentsOpen || gate.einkMenuOpen || gate.moreMenuOpen || gate.shareSheetOpen) return
      if (direction === 'prev') pagedGoPrevRef.current()
      else pagedGoNextRef.current()
    }).then((dispose) => {
      if (cancelled) {
        dispose()
        return
      }
      removeNative = dispose
    })

    const onKeyDown = (event: KeyboardEvent) => {
      const gate = einkGateRef.current
      if (gate.lightbox || gate.commentsOpen || gate.einkMenuOpen || gate.moreMenuOpen || gate.shareSheetOpen) return
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
        event.preventDefault()
        pagedGoPrevRef.current()
      } else if (event.key === 'ArrowRight' || event.key === 'PageDown') {
        event.preventDefault()
        pagedGoNextRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)

    return () => {
      cancelled = true
      window.removeEventListener('keydown', onKeyDown)
      removeNative?.()
      void setVolumePageTurnEnabled(false)
    }
  }, [einkMode])

  const commentsArticle = useMemo(
    () => ({
      id: article.id,
      title: displayedTitle || article.title,
      sourceId: article.sourceId,
      originUrl: resolvedOriginUrl || article.originUrl,
      neteaseDocId: article.neteaseDocId,
    }),
    [
      article.id,
      article.title,
      article.sourceId,
      article.originUrl,
      article.neteaseDocId,
      displayedTitle,
      resolvedOriginUrl,
    ],
  )

  const isCjkArticle = useMemo(() => {
    const textSample = `${displayedTitle} ${displayedHtml.slice(0, 1500)}`
    return /[\p{Script=Han}\u3040-\u30ff\uac00-\ud7af]/u.test(textSample)
  }, [displayedTitle, displayedHtml])

  useEffect(() => {
    // 翻译过程中正文 HTML 高频替换，跳过表格包裹避免重复 DOM 操作
    if (translationState === 'loading') return
    const root = proseRef.current
    if (!root || loadState !== 'ready') return

    root.querySelectorAll('table').forEach((table) => {
      if (table.parentElement?.hasAttribute('data-reader-horizontal-scroll')) return
      const scroller = document.createElement('div')
      scroller.className = 'reader-table-scroll'
      scroller.setAttribute('data-reader-horizontal-scroll', 'true')
      scroller.setAttribute('role', 'region')
      scroller.setAttribute('aria-label', '可横向滚动的表格')
      table.before(scroller)
      scroller.append(table)
    })
  }, [proseHtml, loadState, translationState])

  useProgressiveImages(
    proseRef,
    proseHtml,
    loadState === 'ready' && translationState !== 'loading',
    {
      autoLoad: autoLoadMedia,
      onDeferredPhase,
    },
  )
  const sourceHint = useMemo(() => {
    const origin =
      bodySource === 'feed'
        ? '来自订阅源全文'
        : bodySource === 'netease'
          ? '来自网易正文接口'
          : bodySource === 'readability'
            ? '已在应用内抽取原文'
            : bodySource === 'video'
              ? '视频报道 · 应用内播放'
              : bodySource === 'blocked'
                ? '原站限制 · 仅摘要'
                : null
    if (!origin) return null
    return fromCache ? `${origin} · 离线缓存` : origin
  }, [bodySource, fromCache])

  const isBlockedBody = bodySource === 'blocked'

  /** 出版社地址：只用于「浏览器核对原文」与分享 token 里的正文来源 */
  const originUrl = resolvedOriginUrl || article.originUrl

  const openOriginal = async () => {
    if (!originUrl) return
    await Browser.open({ url: originUrl })
  }

  /**
   * 分享主链接：站内短链，对方点开在网页版里读全文。
   * token 只带原文地址与信源 id，标题由对方抽取正文时自己补。
   */
  const shareUrl = useMemo(() => {
    if (!originUrl) return ''
    return buildShareUrl(sharePayloadFromArticle({ ...article, originUrl }))
  }, [article, originUrl])

  const originHost = useMemo(() => {
    if (!originUrl) return undefined
    try {
      return new URL(originUrl).hostname.replace(/^www\./, '')
    } catch {
      return undefined
    }
  }, [originUrl])

  /** 顶栏「⋯」与墨水屏菜单都收敛到这里：先展示应用内卡片，再交给系统面板 */
  const openShareSheet = useCallback(() => {
    setMoreMenuOpen(false)
    setEinkMenuOpen(false)
    if (!shareUrl) {
      showToast('这篇没有可分享的地址')
      return
    }
    setShareSheetOpen(true)
  }, [shareUrl, showToast])

  const shareClipboardText = useCallback(
    () =>
      buildClipboardText({
        title: displayedTitle || article.title,
        url: shareUrl,
        sourceName: article.sourceName,
      }),
    [article.sourceName, article.title, displayedTitle, shareUrl],
  )

  const handleShare = useCallback(async () => {
    setShareSheetOpen(false)
    const result = await shareArticle({
      title: displayedTitle || article.title,
      url: shareUrl,
      sourceName: article.sourceName,
    })
    if (result === 'copied') showToast('系统分享不可用，已复制站内链接')
    else if (result === 'unsupported') showToast('当前环境无法分享，请手动复制链接')
  }, [article.sourceName, article.title, displayedTitle, shareUrl, showToast])

  const handleCopyLink = useCallback(async () => {
    setMoreMenuOpen(false)
    setShareSheetOpen(false)
    if (!shareUrl) return
    showToast(
      (await copyShareText(shareClipboardText()))
        ? '已复制站内分享链接'
        : '复制失败，请手动选中链接',
    )
  }, [shareClipboardText, shareUrl, showToast])

  const cancelTranslation = useCallback(() => {
    translationAbortRef.current?.abort()
    translationAbortRef.current = null
    if (translationTimeoutRef.current) clearTimeout(translationTimeoutRef.current)
    translationTimeoutRef.current = null
    if (partialFrameRef.current) {
      window.cancelAnimationFrame(partialFrameRef.current)
      partialFrameRef.current = 0
    }
    pendingPartialRef.current = null
  }, [])

  const toggleTranslation = async () => {
    if (loadState !== 'ready') return

    // 1. 如果正在翻译中，点击取消本次翻译并切回原文
    if (translationState === 'loading') {
      cancelTranslation()
      setTranslationState('idle')
      setTranslationError('')
      setShowTranslation(false)
      return
    }

    // 2. 如果当前正在显示译文（或处于报错状态），点击直接切回原文
    if (showTranslation) {
      setShowTranslation(false)
      setTranslationError('')
      return
    }

    // 3. 如果已有完整译文且空闲，直接切换展示
    if (translated && translationState === 'idle') {
      setShowTranslation(true)
      setTranslationError('')
      return
    }

    cancelTranslation()
    const controller = new AbortController()
    translationAbortRef.current = controller
    setTranslationState('loading')
    setTranslationError('')
    setShowTranslation(true)
    setTranslated({ title: article.title, html })

    translationTimeoutRef.current = setTimeout(() => {
      if (translationAbortRef.current !== controller) return
      controller.abort()
      setTranslationError('翻译等待超过 60 秒，请检查网络或翻译服务后重试。')
      setTranslationState('error')
    }, TRANSLATION_TIMEOUT_MS)
    try {
      const flushPartial = () => {
        partialFrameRef.current = 0
        const pending = pendingPartialRef.current
        if (!pending || controller.signal.aborted) return
        setTranslated(pending)
      }
      const result = await createTranslationService(translationPrefs).translateArticle(
        article.title,
        html,
        translationPrefs,
        {
          signal: controller.signal,
          onPartial: (partial) => {
            if (controller.signal.aborted) return
            // 每帧最多落地一次整篇 HTML，避免 batch 回调把主线程打满
            pendingPartialRef.current = partial
            if (partialFrameRef.current) return
            partialFrameRef.current = window.requestAnimationFrame(flushPartial)
          },
        },
      )
      if (controller.signal.aborted) return
      if (partialFrameRef.current) {
        window.cancelAnimationFrame(partialFrameRef.current)
        partialFrameRef.current = 0
      }
      pendingPartialRef.current = null
      setTranslated(result)
      setShowTranslation(true)
      setTranslationState('idle')
    } catch (error) {
      if (controller.signal.aborted) return
      const raw = error instanceof Error ? error.message : '翻译失败'
      setTranslationError(
        raw.includes('MODEL_NOT_DOWNLOADED')
          ? '请先到「我的 → 翻译」下载当前语言包。'
          : raw,
      )
      setTranslationState('error')
    } finally {
      if (translationAbortRef.current === controller) {
        translationAbortRef.current = null
        if (translationTimeoutRef.current) clearTimeout(translationTimeoutRef.current)
        translationTimeoutRef.current = null
      }
      if (partialFrameRef.current) {
        window.cancelAnimationFrame(partialFrameRef.current)
        partialFrameRef.current = 0
      }
      pendingPartialRef.current = null
    }
  }

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col"
      style={{
        paddingTop: 'var(--sat)',
        paddingBottom: 'var(--sab)',
        animation: reduced ? undefined : 'reader-in 360ms var(--ease-ink) both',
      }}
    >
      <style>{`@keyframes reader-in { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: none } }`}</style>

      {hudLabel && (
        <div
          className="pointer-events-none absolute left-1/2 top-[40%] z-30 -translate-x-1/2 rounded-full border border-haze bg-ink/92 px-3.5 py-1.5 font-mono text-[12px] text-paper shadow-lg backdrop-blur-md"
          role="status"
          aria-live="polite"
        >
          {hudLabel}
        </div>
      )}

      <div
        ref={shellRef}
        className="reader-swipe-surface flex min-h-0 flex-1 flex-col bg-ink"
      >
        <header
          data-surface="reader-chrome"
          className={`shrink-0 pt-1 pb-1 border-b border-haze/30 bg-ink/90 backdrop-blur-md sticky top-0 z-20 ${
            einkMode && !chromeVisible ? 'hidden' : ''
          }`}
        >
          <div className="page-x lg:px-8 max-w-4xl mx-auto w-full flex items-center justify-between gap-2">
            <button type="button" onClick={onClose} aria-label="返回列表" className="flex h-9 w-9 shrink-0 items-center justify-center hover:text-paper">
              <ArrowLeft size={18} strokeWidth={1.6} className="text-paper" />
            </button>
            <span className="min-w-0 flex-1 truncate text-center font-mono text-[10px] lg:text-[11px] tracking-[0.18em] text-paper-faint">
              {article.sourceName}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                disabled={loadState !== 'ready' || translationState === 'loading'}
                onClick={() => void toggleTranslation()}
                aria-pressed={showTranslation}
                aria-label={showTranslation ? '显示原文' : '翻译文章'}
                className="flex h-9 items-center gap-1 px-1 transition-colors duration-200 disabled:opacity-40"
              >
                {translationState === 'loading' ? (
                  <LoaderCircle size={14} strokeWidth={1.7} className="animate-spin text-cinnabar-soft" />
                ) : (
                  <Languages size={14} strokeWidth={1.7} className={showTranslation ? 'text-cinnabar' : 'text-paper-muted'} />
                )}
                <span className={`font-mono text-[10px] tracking-[0.08em] ${showTranslation ? 'text-cinnabar-soft' : 'text-paper-muted'}`}>
                  {translationState === 'loading'
                    ? '翻译中'
                    : translationState === 'error'
                      ? '重试'
                      : showTranslation
                        ? '原文'
                        : '翻译'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onToggleLater(laterArticle)}
                aria-pressed={saved}
                aria-label={saved ? '取消收藏' : '收藏'}
                className="flex h-9 items-center gap-1 px-1 transition-colors duration-200"
              >
                {saved ? (
                  <BookmarkCheck size={14} strokeWidth={1.7} className="text-cinnabar" />
                ) : (
                  <BookmarkPlus size={14} strokeWidth={1.7} className="text-paper-muted" />
                )}
                <span className={`hidden font-mono text-[10px] tracking-[0.08em] min-[390px]:inline ${saved ? 'text-cinnabar-soft' : 'text-paper-muted'}`}>
                  {saved ? '已收藏' : '收藏'}
                </span>
              </button>
              {canComment && (
                <button
                  type="button"
                  onClick={() => setCommentsOpen(true)}
                  aria-label="查看跟贴与评论"
                  className="flex h-9 items-center gap-1 px-1 text-paper-muted hover:text-cinnabar transition-colors duration-200"
                >
                  <MessageSquare size={14} strokeWidth={1.7} className={commentsOpen ? 'text-cinnabar' : 'text-paper-muted'} />
                  <span className={`font-mono text-[10px] tracking-[0.08em] ${commentsOpen ? 'text-cinnabar-soft' : 'text-paper-muted'}`}>
                    {commentCount != null && commentCount > 0 ? commentCount : '跟贴'}
                  </span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setMoreMenuOpen(true)}
                aria-label="更多操作：分享、复制链接、浏览器核对原文"
                aria-expanded={moreMenuOpen}
                className="flex h-9 w-9 shrink-0 items-center justify-center hover:text-paper"
              >
                <MoreHorizontal
                  size={16}
                  strokeWidth={1.7}
                  className={moreMenuOpen ? 'text-cinnabar' : 'text-paper-muted'}
                />
              </button>
            </div>
          </div>
        </header>

        <div
          ref={rootRef}
          onScroll={einkMode ? undefined : handleScroll}
          className={`scroll-hidden min-h-0 flex-1 overflow-x-hidden ${
            einkMode
              ? paged.pageSliceHeight > paged.pageHeight
                ? 'overflow-y-auto'
                : 'overflow-hidden'
              : 'overflow-y-auto'
          }`}
        >
          <div
            className="mx-auto w-full max-w-3xl lg:max-w-4xl"
            style={
              einkMode
                ? {
                    transform: `translateY(-${paged.pageOffset}px)`,
                  }
                : undefined
            }
          >
            <div ref={contentMeasureRef}>
            {/* 标题在正文抽取期间就已就位，不随加载状态闪烁 */}
            <div className="page-x lg:px-8 pt-4">
              <span className="flex items-center gap-2 font-mono text-[10px] tracking-[0.16em] text-cinnabar-soft">
                <span className="h-px w-5 bg-cinnabar" aria-hidden />
                {articleRelativeTime(article)}
              </span>
              <h1 className="reader-title mt-3 text-paper">{displayedTitle}</h1>
              {comparing && translated && translated.title && translated.title !== article.title && (
                <p className="reader-title-translation" lang={translationPrefs.targetLanguage}>
                  {translated.title}
                </p>
              )}
              {/* 预留一行高度，正文来源确定后填入，避免标题区抖动 */}
              <p className="mt-3 h-[13px] font-mono text-[10px] leading-[13px] tracking-[0.12em] text-paper-faint">
                {sourceHint}
              </p>
              {isBlockedBody && loadState === 'ready' && (
                <div
                  role="status"
                  className="mt-3.5 rounded-2xl border border-haze bg-ink-raised/80 p-3.5 text-[12.5px] leading-relaxed text-paper-muted"
                >
                  <p className="text-paper">
                    原站有付费墙或反爬限制，站内只能展示摘要。完整正文请在浏览器打开核对。
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {(resolvedOriginUrl || article.originUrl) && (
                      <button
                        type="button"
                        onClick={() => void openOriginal()}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-cinnabar px-3 py-1.5 font-mono text-[11px] font-medium text-white hover:bg-cinnabar-soft active:scale-95 transition-all"
                      >
                        <Globe size={12} strokeWidth={2} />
                        打开原文
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setRetryToken((token) => token + 1)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-haze bg-ink px-3 py-1.5 font-mono text-[11px] text-paper-muted hover:text-paper active:scale-95 transition-all"
                    >
                      <RefreshCw size={12} strokeWidth={2} />
                      重新抽取
                    </button>
                  </div>
                </div>
              )}
              {(showTranslation || translationState === 'loading') && (
                <p className="mt-2 font-mono text-[9.5px] tracking-[0.1em] text-cinnabar-soft">
                  {translationState === 'loading'
                    ? `${translationProviderLabel(translationPrefs.provider)} 正在翻译正文…`
                    : `${translationProviderLabel(translationPrefs.provider)} · ${translationDisplayModeLabel(translationPrefs.displayMode)} · 已译为${translationLanguageLabel(translationPrefs.targetLanguage)}`}
                </p>
              )}
              {showTranslation && translated?.usedFallback && translationState === 'idle' && (
                <p className="mt-2 font-mono text-[9.5px] tracking-[0.08em] text-paper-faint">
                  未可靠识别原文语言，已按英语翻译
                </p>
              )}
              {translationError && (
                <div
                  role="alert"
                  className="mt-3.5 flex items-start justify-between gap-3 rounded-2xl border border-cinnabar/35 bg-cinnabar/10 p-3.5 text-[12px] leading-relaxed text-cinnabar-soft shadow-sm"
                >
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium">{translationError}</p>
                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setTranslationState('idle')
                          setTranslationError('')
                          void toggleTranslation()
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-cinnabar/50 bg-cinnabar/15 px-2.5 py-1 font-mono text-[11px] font-medium text-cinnabar-soft hover:bg-cinnabar/25 active:scale-95 transition-all"
                      >
                        <RefreshCw size={11} strokeWidth={2} />
                        重新翻译
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowTranslation(false)
                          setTranslationError('')
                          setTranslationState('idle')
                        }}
                        className="inline-flex items-center gap-1 rounded-lg border border-haze bg-ink-raised px-2.5 py-1 font-mono text-[11px] text-paper-muted hover:text-paper active:scale-95 transition-all"
                      >
                        显示原文
                      </button>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setTranslationError('')}
                    aria-label="关闭翻译错误提示"
                    className="shrink-0 -mr-1 -mt-1 rounded-lg p-1 text-cinnabar-soft/70 hover:bg-cinnabar/20 hover:text-cinnabar-soft active:scale-95 transition-all"
                  >
                    <X size={15} strokeWidth={2} />
                  </button>
                </div>
              )}
            </div>

            {coverUrl && article.contentType !== 'video' && (
              <div className="mt-5 page-x lg:px-8">
                <InkImage
                  src={coverUrl}
                  deferLoad={!autoLoadMedia}
                  eager
                  collapseOnError
                  className="h-[220px] w-full sm:h-[300px] md:h-[380px] lg:h-[420px] rounded-xl overflow-hidden"
                  onOpen={
                    einkMode ? undefined : (src) => setLightbox({ src, alt: article.title })
                  }
                />
              </div>
            )}

            {useOriginSurface && (resolvedOriginUrl || article.originUrl) && (
              <OriginPlayerSurface
                pageUrl={resolvedOriginUrl || article.originUrl!}
                referrer={resolvedOriginUrl || article.originUrl}
                title={article.title}
                poster={article.image}
                openOriginal={() => void openOriginal()}
                closeHandleRef={originPlayerCloseRef}
              />
            )}

            {!useOriginSurface && article.contentType === 'video' && !article.videoUrl && loadState === 'loading' && (
              <div data-reader-block className="page-x mt-5">
                <VideoSniffPlaceholder state="sniffing" poster={article.image} />
              </div>
            )}

            {!useOriginSurface && article.contentType === 'video' && article.videoUrl && loadState === 'ready' && !/<video\b/i.test(displayedHtml) && (
              <div data-reader-block className="page-x mt-5">
                <InkVideoPlayer
                  src={article.videoUrl}
                  poster={article.image}
                  title={article.title}
                  sourcePage={resolvedOriginUrl || article.originUrl}
                  onRefreshSource={() => setRetryToken((value) => value + 1)}
                  deferLoad={!autoLoadMedia}
                  onUnlocked={() => {
                    if (article.videoUrl) {
                      setUnlockedMediaUrls((prev) =>
                        prev.includes(article.videoUrl!) ? prev : [...prev, article.videoUrl!],
                      )
                    }
                  }}
                />
              </div>
            )}

            {article.audioUrl && loadState === 'ready' && !/<audio\b/i.test(displayedHtml) && (
              <div data-reader-block className="page-x mt-5">
                <InkAudioPlayer
                  src={article.audioUrl}
                  title={article.title}
                  deferLoad={!autoLoadMedia}
                  onUnlocked={() => {
                    if (article.audioUrl) {
                      setUnlockedMediaUrls((prev) =>
                        prev.includes(article.audioUrl!) ? prev : [...prev, article.audioUrl!],
                      )
                    }
                  }}
                />
              </div>
            )}

            <div className="page-x pt-6" style={{ paddingBottom: '40px' }}>
              {loadState === 'loading' && <ReaderSkeleton />}

              {loadState === 'error' && (
                <div className="rounded-2xl border border-haze bg-ink-raised/80 px-5 py-6">
                  <p className="font-display text-[20px] text-paper">正文暂时未能展开</p>
                  <p className="mt-2 text-[13px] leading-relaxed text-paper-muted">
                    {error || '网络或站点限制导致抽取失败。可重试，或在浏览器打开原文。'}
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setRetryToken((value) => value + 1)}
                      className="inline-flex items-center gap-2 rounded-full border border-cinnabar/50 bg-cinnabar/15 px-4 py-2.5 text-[13px] text-paper"
                    >
                      <RefreshCw size={14} strokeWidth={1.7} className="text-cinnabar-soft" />
                      重新抽取正文
                    </button>
                    {(resolvedOriginUrl || article.originUrl) && (
                      <button
                        type="button"
                        onClick={() => void openOriginal()}
                        className="inline-flex items-center gap-2 rounded-full border border-haze px-4 py-2.5 text-[13px] text-paper-muted"
                      >
                        <Globe size={14} strokeWidth={1.7} />
                        浏览器打开原文
                      </button>
                    )}
                  </div>
                </div>
              )}

              {loadState === 'ready' && (
                <>
                  <ArticleProseHtml
                    innerRef={proseRef}
                    html={proseHtml}
                    lang={isCjkArticle ? 'zh' : 'en'}
                    className={`reader-prose ${
                      showTranslation && translationState === 'loading'
                        ? 'translation-pending'
                        : showTranslation && translationState === 'error'
                          ? 'translation-failed'
                          : ''
                    }`}
                  />
                  <InlineArticleVideos
                    rootRef={proseRef}
                    html={proseHtml}
                    enabled={loadState === 'ready' && translationState !== 'loading'}
                    fallbackTitle={displayedTitle}
                    sourcePage={resolvedOriginUrl || article.originUrl}
                    onRefreshSource={() => setRetryToken((value) => value + 1)}
                    deferLoad={!autoLoadMedia}
                    onUnlocked={onUnlockedMedia}
                    fullscreenHandleRef={videoFullscreenRef}
                  />
                  <InlineArticleAudio
                    rootRef={proseRef}
                    html={proseHtml}
                    enabled={loadState === 'ready' && translationState !== 'loading'}
                    fallbackTitle={displayedTitle}
                    deferLoad={!autoLoadMedia}
                    onUnlocked={onUnlockedMedia}
                  />
                  <InlineYoutubeEmbeds
                    rootRef={proseRef}
                    html={proseHtml}
                    enabled={loadState === 'ready' && translationState !== 'loading'}
                    fallbackTitle={displayedTitle}
                    sourcePage={resolvedOriginUrl || article.originUrl}
                    deferLoad={!autoLoadMedia}
                    unlockedUrls={unlockedSet}
                    onUnlocked={onUnlockedMedia}
                    fullscreenHandleRef={videoFullscreenRef}
                  />
                </>
              )}

              {loadState === 'ready' && (
                <div data-reader-block className="mt-8">
                  <div className="h-px w-full bg-haze" />
                  <p className="mt-4 font-mono text-[10px] leading-relaxed text-paper-faint">
                    来源 {article.sourceName}
                    <br />
                    {resolvedOriginUrl || article.originUrl || '原文地址缺失'}
                  </p>
                </div>
              )}

              {loadState === 'ready' && canComment && (
                <div data-reader-block className="mt-8">
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setCommentsOpen(true)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setCommentsOpen(true)
                    }}
                    className="group flex w-full cursor-pointer items-center justify-between rounded-2xl border border-haze bg-ink-raised/80 p-4.5 transition hover:border-cinnabar/50 hover:bg-ink-raised"
                  >
                    <div className="flex items-center gap-3.5 min-w-0">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-cinnabar/15 text-cinnabar group-hover:bg-cinnabar group-hover:text-white transition">
                        <MessageSquare size={20} />
                      </div>
                      <div className="min-w-0 text-left">
                        <h3 className="text-[14px] font-semibold text-paper group-hover:text-cinnabar transition">
                          网友精彩跟贴与讨论
                        </h3>
                        <p className="mt-0.5 font-mono text-[11px] text-paper-faint truncate">
                          {commentCount != null && commentCount > 0
                            ? `共 ${commentCount} 条跟贴互动 · 点击展开热评与盖楼`
                            : '点击展开网友观点与最新讨论'}
                        </p>
                      </div>
                    </div>
                    <span className="shrink-0 rounded-full border border-haze bg-ink px-3 py-1.5 font-mono text-[11px] font-medium text-paper-muted group-hover:border-cinnabar/40 group-hover:text-cinnabar transition">
                      展开讨论 →
                    </span>
                  </div>
                </div>
              )}
            </div>
            </div>
          </div>
        </div>

      {einkMode && loadState === 'ready' && !einkMenuOpen && (
        <div
          data-surface="reader-chrome"
          className={`shrink-0 border-t border-haze/40 bg-ink pt-1.5 pb-4`}
        >
          <p className="text-center font-mono text-[11px] tracking-[0.12em] text-paper-faint">
            {paged.pageIndex + 1} / {Math.max(paged.pages.length, 1)}
          </p>
        </div>
      )}
      </div>

      {einkMode && (
        <EinkReaderMenu
          open={einkMenuOpen}
          pageIndex={paged.pageIndex}
          pageCount={paged.pages.length}
          fontScale={fontScale}
          saved={saved}
          translating={translationState === 'loading'}
          showTranslation={showTranslation}
          onClose={() => setEinkMenuOpen(false)}
          onFontScale={(next) => onTypographyChange?.({ fontScale: next })}
          onJumpPage={(index) => paged.setPageIndex(index)}
          onToggleTranslation={() => void toggleTranslation()}
          onToggleLater={() => onToggleLater(laterArticle)}
          onShare={openShareSheet}
          onBackToList={onClose}
          onOpenSettings={() => {
            setEinkMenuOpen(false)
            onOpenSettings?.()
          }}
        />
      )}

      <ReaderMoreMenu
        open={moreMenuOpen}
        hasOriginUrl={Boolean(originUrl)}
        onClose={() => setMoreMenuOpen(false)}
        onShare={openShareSheet}
        onCopyLink={() => void handleCopyLink()}
        onOpenOriginal={() => {
          setMoreMenuOpen(false)
          void openOriginal()
        }}
        onReextract={() => {
          setMoreMenuOpen(false)
          setRetryToken((token) => token + 1)
        }}
      />

      <ShareArticleSheet
        open={shareSheetOpen}
        title={displayedTitle || article.title}
        sourceName={article.sourceName}
        summary={article.summary}
        publishedAt={article.publishedAt}
        hasRealDate={article.hasRealDate}
        shareUrl={shareUrl}
        originHost={originHost}
        onClose={() => setShareSheetOpen(false)}
        onShare={() => void handleShare()}
        onCopy={() => void handleCopyLink()}
      />

      {/* 分享卡片占满底部，reader 级悬浮件一律让位，避免压住「复制链接 / 分享」 */}
      {(toast || resumedPosition) && !shareSheetOpen && (
        <div
          className="pointer-events-none absolute inset-x-0 z-40 flex justify-center px-4 safe-bottom-20"
          role="status"
          aria-live="polite"
        >
          {toast ? (
            <span className="rounded-full border border-haze bg-ink/95 px-3.5 py-2 font-mono text-[11.5px] text-paper shadow-xl backdrop-blur-md">
              {toast}
            </span>
          ) : (
            <span className="pointer-events-auto flex items-center gap-2 rounded-full border border-haze bg-ink/95 px-3.5 py-2 font-mono text-[11.5px] text-paper shadow-xl backdrop-blur-md">
              已回到上次阅读位置
              <button
                type="button"
                onClick={() => {
                  const el = rootRef.current
                  if (el) el.scrollTop = 0
                  forgetReadingPosition(article.id)
                  setResumedPosition(false)
                }}
                className="text-cinnabar-soft underline-offset-2 hover:underline"
              >
                回到开头
              </button>
              <button
                type="button"
                onClick={() => setResumedPosition(false)}
                aria-label="关闭提示"
                className="text-paper-faint hover:text-paper"
              >
                <X size={13} strokeWidth={2} />
              </button>
            </span>
          )}
        </div>
      )}

      {/* 底部右下角悬浮跟贴胶囊（随时一触即达） */}
      {canComment && !commentsOpen && !shareSheetOpen && !einkMode && (
        <div
          className={`fixed right-4 z-40 transition-all duration-300 pointer-events-auto safe-bottom-20 ${
            (einkMode ? chromeVisible : pillVisible)
              ? 'opacity-100 translate-y-0 scale-100'
              : 'opacity-0 translate-y-6 scale-90 pointer-events-none'
          }`}
        >
          <button
            type="button"
            onClick={() => setCommentsOpen(true)}
            aria-label="查看跟贴讨论"
            className="group flex items-center gap-2 rounded-full border border-haze bg-ink/95 px-3.5 py-2 text-paper shadow-xl shadow-black/35 backdrop-blur-md transition hover:scale-105 hover:border-cinnabar/60 active:scale-95"
          >
            <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-cinnabar/15 text-cinnabar group-hover:bg-cinnabar group-hover:text-white transition">
              <MessageSquare size={13} strokeWidth={2} />
            </div>
            <span className="font-mono text-[12px] font-medium tracking-[0.03em] text-paper">
              {commentCount != null && commentCount > 0 ? (
                <>
                  <span className="text-cinnabar font-semibold">{commentCount}</span> 跟贴
                </>
              ) : (
                '看跟贴'
              )}
            </span>
          </button>
        </div>
      )}

      {lightbox && (
        <ImageLightbox
          src={lightbox.src}
          alt={lightbox.alt}
          onClose={() => setLightbox(null)}
          overlayCloserRef={overlayCloserRef}
        />
      )}

      <CommentsDrawer
        open={commentsOpen}
        onClose={() => setCommentsOpen(false)}
        article={commentsArticle}
      />
    </div>
  )
}

const SKELETON_LINES = [92, 100, 88, 96, 74, 100, 90, 66]

const ArticleProseHtml = memo(function ArticleProseHtml({
  html,
  lang,
  className,
  innerRef,
}: {
  html: string
  lang: 'zh' | 'en'
  className: string
  innerRef: RefObject<HTMLDivElement | null>
}) {
  return (
    <div
      ref={innerRef}
      data-reader-block
      data-article-lang={lang}
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})

function ReaderSkeleton() {
  return (
    <div aria-hidden>
      <div className="flex items-center gap-2 pb-6 font-mono text-[10px] tracking-[0.2em] text-paper-faint">
        <span
          className="block h-1.5 w-1.5 rounded-full bg-cinnabar"
          style={{ animation: 'ink-pulse 1.4s var(--ease-ink) infinite' }}
        />
        正在展开正文
      </div>

      <div className="space-y-3.5">
        {SKELETON_LINES.map((width, index) => (
          <div
            key={index}
            className="ink-shimmer h-3 rounded-full"
            style={{ width: `${width}%`, animationDelay: `${index * 80}ms` }}
          />
        ))}
      </div>
    </div>
  )
}
