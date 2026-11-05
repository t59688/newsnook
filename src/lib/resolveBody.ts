import { isVideoDocumentUrl } from './videoDocumentUrl'
import { isPrimaryVideoPage } from '../features/mediaSniffer/pageEvidence'
/**
 * 站内正文解析入口。实现按边界拆在 resolveBody/ 子模块：
 * - guards：反爬/付费墙识别、摘要 Feed 判定、软降级正文
 * - extractors：Readability 主路径与优设/公众号/OpenAI News 站点定制抽取
 * - siteBodies：虎嗅/网易/知乎/机器之心/新智元详情接口正文
 * - video：视频占位正文与媒体嗅探增量更新
 * 对外导入路径保持 `lib/resolveBody` 不变。
 */

import { shouldUseOriginPlayerSurface } from '../features/mediaSniffer/originPlayerGate'
import { discoverMediaDescriptor, mediaDescriptorHtml } from '../features/mediaSniffer/service'
import { firstImageIn } from './articlePreview'
import { appendRelatedCatalogHtml, extractRelatedCatalog } from '../features/catalogEngine/related'
import { extractWebCatalogDetailMeta } from '../features/catalogEngine/detailMeta'
import { normalizeCatalogTitle } from '../features/catalogEngine/normalize'
import { catalogRequestOptions } from '../features/siteCatalog/requestIdentity'
import { nnyyListingUrlForDetail } from '../features/frameworkDetect/adapters/nnyy'
import { findSource, userAgentFor, type NewsSource } from '../sources/registry'
import { cleanSummaryText } from './cleanSummary'
import { collectAudioSrc, ensureArticleAudioHtml } from './articleAudio'
import {
  fetchAbsoluteFormPost,
  fetchAbsoluteText,
  googleTranslateProxyUrl,
} from './http'
import { decodeGoogleNewsUrl, isGoogleNewsArticleUrl } from './googleNewsDecode'
import { sanitizeArticleHtml } from './sanitize'
import type { Article } from './types'
import { hasBrokenTextEncoding } from './textEncoding'
import {
  CRAWLER_FALLBACK_UAS,
  buildBlockedPublisherFallback,
  isBlockedPublisherHtml,
  isInlineFlashBody,
  isScrapeNoticeBody,
  isSubstantialHtml,
  preferPublisherFetchUrl,
} from './resolveBody/guards'
import { extractWithReadability, isLikelyVideoPageUrl } from './resolveBody/extractors'
import { isPreferredFeedBody, isPartialFeedTeaser } from './feedBodyEvidence'
import { recoverFeedContent } from './resolveBody/feedContent'
import { normalizeFeedLayout } from './resolveBody/feedLayout'
import {
  resolveAieraBody,
  resolveHuxiuVideoBody,
  resolveJiqizhixinBody,
  resolveNetEaseArticleBody,
  resolveZhihuBody,
  candidateNeteaseIds,
} from './resolveBody/siteBodies'
import {
  absolutizeHtml,
  escapeHtml,
  stripTags,
  type MediaResolvedHandler,
  type ResolvedBody,
} from './resolveBody/shared'
import {
  applyMediaDescriptor,
  buildTrustedEmbeddedVideoBody,
  buildVideoBody,
  scheduleMediaDiscovery,
  withVideoDiscoveryFailed,
} from './resolveBody/video'

export type { BodySource, MediaResolvedHandler, ResolvedBody } from './resolveBody/shared'
export {
  CRAWLER_FALLBACK_UAS,
  buildBlockedPublisherFallbackForTest,
  isBlockedPublisherHtml,
  isInlineFlashBody,
  isPartialFeedTeaser,
  isScrapeNoticeBody,
  isSubstantialHtml,
  preferPublisherFetchUrl,
} from './resolveBody/guards'
export {
  extractUisdcBodyHtml,
  extractWechatArticleTitle,
  extractWechatBodyHtml,
  isWechatArticleUrl,
} from './resolveBody/extractors'
export {
  aieraPostIdForTest,
  buildHuxiuVideoBodyForTest,
  candidateNeteaseIds,
  parseAieraRestPostForTest,
} from './resolveBody/siteBodies'
export { buildVideoBodyForTest } from './resolveBody/video'

/** 正文抓取使用的 UA：优先自定义/额外源表，找不到则 undefined（走 http 默认 UA） */
export function pageUserAgentForArticle(
  article: Article,
  extraSources?: NewsSource[],
): string | undefined {
  return pageRequestOptionsForArticle(article, extraSources).userAgent
}

function pageRequestOptionsForArticle(article: Article, extraSources?: NewsSource[]) {
  const source = findSource(article.sourceId, extraSources)
  return source?.kind === 'web-catalog'
    ? catalogRequestOptions(source.userAgent)
    : { userAgent: source ? userAgentFor(source) : undefined }
}

function relatedExcludeUrls(source: NewsSource | undefined): string[] {
  return source?.frameworkHint?.categories?.map((item) => item.url) ?? []
}

/** 自定义 CMS 详情页：把上游已有的相关卡片接到正文后，不做客户端推荐。 */
async function withRelatedFromPage(
  resolved: ResolvedBody,
  pageHtml: string | undefined,
  pageUrl: string,
  article: Article,
  extraSources?: NewsSource[],
  signal?: AbortSignal,
): Promise<ResolvedBody> {
  if (!pageHtml) return resolved
  const source = findSource(article.sourceId, extraSources)
  if (!source || source.kind !== 'web-catalog') return resolved

  const meta = extractWebCatalogDetailMeta(pageHtml)
  let items = extractRelatedCatalog(pageHtml, pageUrl, {
    excludeUrls: relatedExcludeUrls(source),
  })

  if (items.length < 2 && source.frameworkHint?.framework === 'nnyy') {
    const listingUrl = nnyyListingUrlForDetail(pageUrl)
    if (listingUrl) {
      const listingHtml = await fetchAbsoluteText(listingUrl, {
        signal,
        ...pageRequestOptionsForArticle(article, extraSources),
      }).catch(() => undefined)
      if (listingHtml) {
        items = extractRelatedCatalog(listingHtml, listingUrl, {
          excludeUrls: [...relatedExcludeUrls(source), pageUrl],
          maxItems: 12,
        })
      }
    }
  }

  let contentHtml = resolved.contentHtml
  if (resolved.bodySource === 'video') {
    const synopsis =
      meta.synopsis ||
      normalizeCatalogTitle(cleanSummaryText(article.summary, meta.title || article.title))
    if (synopsis && synopsis.length >= 12) {
      const clipped = synopsis.length > 220 ? `${synopsis.slice(0, 217)}…` : synopsis
      contentHtml = contentHtml.replace(
        /<p>[\s\S]*?<\/p>\s*$/i,
        `<p>${escapeHtml(clipped)}</p>`,
      )
    }
  }

  if (items.length) {
    contentHtml = appendRelatedCatalogHtml(contentHtml, items)
  }

  return {
    ...resolved,
    title: meta.title || resolved.title,
    contentHtml: sanitizeArticleHtml(contentHtml),
  }
}

function withArticleAudio(
  resolved: ResolvedBody,
  article: Article,
  pageHtml?: string,
): ResolvedBody {
  if (resolved.bodySource === 'video' || resolved.bodySource === 'blocked') return resolved
  const audioUrl =
    article.audioUrl || collectAudioSrc(resolved.contentHtml) || collectAudioSrc(pageHtml)
  if (!audioUrl) return resolved
  return {
    ...resolved,
    contentHtml: sanitizeArticleHtml(ensureArticleAudioHtml(resolved.contentHtml, audioUrl)),
  }
}

/**
 * 保证详情页拿到可渲染全文。
 * 优先级：视频稿 → Feed 充足全文 → 网易正文接口 → 原文 HTML + Readability。
 */
export async function resolveArticleBody(
  article: Article,
  signal?: AbortSignal,
  extraSources?: NewsSource[],
  onMediaResolved?: MediaResolvedHandler,
): Promise<ResolvedBody> {
  // The list cache keeps a lightweight completeness signal, not full HTML.
  // Rehydrate only complete/legacy generic feeds when their body is absent.
  const source = findSource(article.sourceId, extraSources)
  if (source?.kind === 'web-catalog' && article.contentType !== 'video' && isVideoDocumentUrl(article.originUrl)) {
    article = { ...article, contentType: 'video' }
  }
  let feedArticle = article
  if (source?.kind === 'feed' && article.contentType !== 'video' && !article.contentHtml) {
    try {
      feedArticle = await recoverFeedContent(article, source, signal)
    } catch (error) {
      if (signal?.aborted) throw error
    }
  }
  const availableFeedHtml = feedArticle.contentHtml
  const renderFeed = async (excerpt = false): Promise<ResolvedBody> => {
    const baseUrl = article.originUrl || 'https://local.invalid/'
    let contentHtml = await absolutizeHtml(normalizeFeedLayout(availableFeedHtml!), baseUrl)
    const embeddedFrames = availableFeedHtml!.match(/<iframe\b[^>]*>/gi) || []
    const hasNonYoutubeEmbed = embeddedFrames.some(
      (frame) => !/youtube(?:-nocookie)?\.com\/embed\//i.test(frame),
    )
    if (hasNonYoutubeEmbed && article.originUrl) {
      const mediaOptions = {
        pageUrl: article.originUrl,
        html: availableFeedHtml,
        runtime: true,
        timeoutMs: 6000,
        signal,
      } as const
      if (onMediaResolved) {
        scheduleMediaDiscovery(
          mediaOptions,
          { contentHtml, bodySource: excerpt ? 'feed-excerpt' : 'feed' },
          article.title,
          article.image,
          (resolved) => onMediaResolved(withArticleAudio(resolved, article)),
        )
      } else {
        const descriptor = await discoverMediaDescriptor(mediaOptions).catch(() => null)
        const enriched = applyMediaDescriptor(
          { contentHtml, bodySource: excerpt ? 'feed-excerpt' : 'feed' },
          descriptor,
          article.title,
          article.image,
        )
        if (enriched) contentHtml = enriched.contentHtml
      }
    }
    return withArticleAudio(
      {
        contentHtml,
        bodySource: excerpt ? 'feed-excerpt' : 'feed',
        image: firstImageIn(availableFeedHtml!, article.originUrl),
      },
      article,
    )
  }

  if (
    article.contentType !== 'video' && availableFeedHtml &&
    !hasBrokenTextEncoding(availableFeedHtml) &&
    feedArticle.feedBodyEvidence !== 'teaser' &&
    !isPartialFeedTeaser(availableFeedHtml) &&
    (isInlineFlashBody(availableFeedHtml, article.sourceId) ||
      (source?.kind === 'feed'
        ? isPreferredFeedBody(feedArticle.feedBodyEvidence)
        : isSubstantialHtml(availableFeedHtml)))
  ) {
    return renderFeed()
  }

  // 新 RSS 视频稿带 contentType；旧列表缓存没有该字段，但正文同样很短。
  // 两种情况都在通用网页抽取前查一次详情 API，普通 RSS 全文已在上方直接返回。
  const huxiu = await resolveHuxiuVideoBody(article, signal).catch(() => null)
  if (huxiu) return huxiu

  if (article.contentType === 'video') {
    if (article.videoUrl) return buildVideoBody(article)

    const useOriginSurface = shouldUseOriginPlayerSurface({
      sourceId: article.sourceId,
      contentType: article.contentType,
    })

    // Android 自建源：Reader 外层显示原站可见 WebView + 持续旁路嗅探。
    // 正文只保留描述，避免再塞一个 iframe/占位播放器造成双播放器。
    if (useOriginSurface) {
      const base: ResolvedBody = {
        contentHtml: sanitizeArticleHtml(
          (article.summary || article.title)
            .split(/\n+/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => `<p>${escapeHtml(line)}</p>`)
            .join(''),
        ),
        bodySource: 'video',
      }
      if (!article.originUrl) return base
      if (onMediaResolved) {
        void fetchAbsoluteText(article.originUrl, {
          signal,
          ...pageRequestOptionsForArticle(article, extraSources),
        })
          .then(async (pageHtml) => {
            onMediaResolved(
              await withRelatedFromPage(
                base,
                pageHtml,
                article.originUrl,
                article,
                extraSources,
                signal,
              ),
            )
          })
          .catch(() => onMediaResolved(base))
        return base
      }
      const pageHtml = await fetchAbsoluteText(article.originUrl, {
        signal,
        ...pageRequestOptionsForArticle(article, extraSources),
      }).catch(() => undefined)
      return await withRelatedFromPage(
        base,
        pageHtml,
        article.originUrl,
        article,
        extraSources,
        signal,
      )
    }

    // Web 没有 Android 的跨域 WebView 网络观察器。Feed 已经给出官方播放器时，
    // 直接使用受信 iframe，避免先请求 /api/page；上游反爬/网络失败也不应让播放器消失。
    const embeddedBody = buildTrustedEmbeddedVideoBody(article)
    if (embeddedBody) return embeddedBody

    if (!article.originUrl) return buildVideoBody(article, 'failed')

    if (onMediaResolved) {
      const base = buildVideoBody(article)
      void fetchAbsoluteText(article.originUrl, {
        signal,
        ...pageRequestOptionsForArticle(article, extraSources),
      })
        .then(async (pageHtml) => {
          const withRelated = await withRelatedFromPage(
            base,
            pageHtml,
            article.originUrl,
            article,
            extraSources,
            signal,
          )
          onMediaResolved(withRelated)
          scheduleMediaDiscovery(
            {
              pageUrl: article.originUrl,
              html: pageHtml,
              runtime: true,
              // 视频页需要完整加载播放器并触发媒体请求；预告片后才出正片时 9s 不够
              timeoutMs: 12000,
              signal,
          },
          withRelated,
          article.title,
          article.image,
          onMediaResolved,
          false,
        )
        })
        .catch(() => {
          onMediaResolved(withVideoDiscoveryFailed(base))
        })
      return base
    }

    const pageHtml = await fetchAbsoluteText(article.originUrl, {
      signal,
      ...pageRequestOptionsForArticle(article, extraSources),
    }).catch(() => undefined)
    const descriptor = await discoverMediaDescriptor({
      pageUrl: article.originUrl,
      html: pageHtml,
      runtime: true,
      timeoutMs: 12000,
      signal,
    }).catch(() => null)
    if (!descriptor) {
      return await withRelatedFromPage(
        buildVideoBody(article, 'failed'),
        pageHtml,
        article.originUrl,
        article,
        extraSources,
        signal,
      )
    }
    const content = article.summary
      ? `<p>${escapeHtml(article.summary)}</p>`
      : ''
    return await withRelatedFromPage(
      {
        contentHtml: sanitizeArticleHtml(
          mediaDescriptorHtml(descriptor, {
            title: article.title,
            poster: article.image,
            contentHtml: content,
          }),
        ),
        image: article.image,
        bodySource: 'video',
      },
      pageHtml,
      article.originUrl,
      article,
      extraSources,
      signal,
    )
  }

  const netease = await resolveNetEaseArticleBody(article, signal).catch(() => null)
  if (netease) return netease

  const zhihu = await resolveZhihuBody(article, signal).catch(() => null)
  if (zhihu) return zhihu

  const jiqizhixin = await resolveJiqizhixinBody(article, signal).catch(() => null)
  if (jiqizhixin) return jiqizhixin

  const aiera = await resolveAieraBody(article, signal).catch(() => null)
  if (aiera) return aiera

  if (!article.originUrl) {
    throw new Error('缺少原文地址，无法抽取正文')
  }

  let originUrl = preferPublisherFetchUrl(article.originUrl)
  let resolvedOriginUrl: string | undefined

  if (isGoogleNewsArticleUrl(originUrl)) {
    try {
      originUrl = await decodeGoogleNewsUrl(
        originUrl,
        {
          getText: (url, sig) => fetchAbsoluteText(url, { signal: sig }),
          postForm: (url, form, sig) =>
            fetchAbsoluteFormPost(url, form, {
              signal: sig,
              headers: { Referer: 'https://news.google.com/' },
            }),
        },
        signal,
      )
      originUrl = preferPublisherFetchUrl(originUrl)
      resolvedOriginUrl = originUrl
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `无法跳转到原网站：${error.message}`
          : '无法跳转到原网站',
      )
    }
  }

  // 视频页也可走 Readability 兜底
  const candidates: string[] = []
  // 网易：full.html 偶发 204、news.163.com 常 404；优先移动站与网易号落地页
  for (const docid of candidateNeteaseIds(article)) {
    candidates.push(
      `https://m.163.com/news/article/${docid}.html`,
      `https://www.163.com/dy/article/${docid}.html`,
    )
  }
  candidates.push(originUrl)
  // 历史缓存可能仍是裸域链接；www 优先已由 preferPublisherFetchUrl 处理，再兜底试一次裸域无意义
  if (originUrl.includes('/trad')) {
    candidates.push(originUrl.replace('/trad', '/simp'))
  }
  if (originUrl.includes('/simp')) {
    candidates.push(originUrl.replace('/simp', '/trad'))
  }

  const tried = new Set<string>()
  let lastError: unknown
  const pageOptions = pageRequestOptionsForArticle(article, extraSources)
  const pageUa = pageOptions.userAgent

  const tryExtract = async (pageUrl: string, userAgent = pageUa): Promise<ResolvedBody> => {
    const pageHtml = await fetchAbsoluteText(pageUrl, {
      signal,
      ...pageOptions,
      userAgent,
    })
    if (!pageHtml.trim() || pageHtml.length < 200) {
      throw new Error('原文页为空')
    }
    if (isBlockedPublisherHtml(pageHtml)) {
      throw new Error('原站拒绝抓取')
    }
    if (hasBrokenTextEncoding(pageHtml)) {
      throw new Error('原文字符集解析失败')
    }
    if (source?.kind === 'web-catalog' && isPrimaryVideoPage(pageHtml, pageUrl)) {
      const videoArticle = { ...article, contentType: 'video' as const }
      const ownedSurface = shouldUseOriginPlayerSurface({ sourceId: article.sourceId, contentType: 'video' })
      const base: ResolvedBody = ownedSurface
        ? { contentHtml: `<p>${escapeHtml(article.summary || article.title)}</p>`, bodySource: 'video', resolvedOriginUrl: pageUrl }
        : { ...buildVideoBody(videoArticle), resolvedOriginUrl: pageUrl }
      const result = await withRelatedFromPage(base, pageHtml, pageUrl, videoArticle, extraSources, signal)
      if (!ownedSurface) scheduleMediaDiscovery({ pageUrl, html: pageHtml, runtime: true, signal }, result, article.title, article.image, onMediaResolved)
      return result
    }
    let extracted = await extractWithReadability(pageHtml, pageUrl)
    let mediaBase: ResolvedBody | undefined
    let mediaOptions: Parameters<typeof discoverMediaDescriptor>[0] | undefined
    if (hasBrokenTextEncoding(extracted.contentHtml)) {
      throw new Error('正文字符集解析失败')
    }
    if (!/<video\b/i.test(extracted.contentHtml)) {
      const mayContainMedia = isLikelyVideoPageUrl(pageUrl) || /<(?:video|source|iframe)\b|VideoObject|\.m3u8(?:[?"'])|\.mpd(?:[?"'])|\.mp4(?:[?"'])/i.test(pageHtml)
      if (mayContainMedia) {
        const options = {
          pageUrl,
          html: pageHtml,
          runtime: true,
          timeoutMs: 4500,
          signal,
        } as const
        if (onMediaResolved) {
          const base = withArticleAudio({ ...extracted, resolvedOriginUrl }, article, pageHtml)
          mediaBase = base
          mediaOptions = options
        } else {
          const descriptor = await discoverMediaDescriptor(options).catch(() => null)
          const enriched = applyMediaDescriptor(
            extracted,
            descriptor,
            extracted.title || article.title,
            extracted.image || article.image,
          )
          if (enriched) extracted = enriched
        }
      }
    }
    if (stripTags(extracted.contentHtml).length < 80 && !/<video\b/i.test(extracted.contentHtml)) {
      throw new Error('抽取正文过短')
    }
    if (isScrapeNoticeBody(extracted.contentHtml)) {
      throw new Error('原站仅返回反爬声明')
    }
    const resolved = await withRelatedFromPage(
      mediaBase || withArticleAudio({ ...extracted, resolvedOriginUrl }, article, pageHtml),
      pageHtml,
      pageUrl,
      article,
      extraSources,
      signal,
    )
    if (mediaBase && mediaOptions) {
      scheduleMediaDiscovery(
        mediaOptions,
        resolved,
        extracted.title || article.title,
        extracted.image || article.image,
        onMediaResolved,
      )
    }
    return resolved
  }

  for (const pageUrl of candidates) {
    if (!pageUrl || tried.has(pageUrl)) continue
    tried.add(pageUrl)
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await tryExtract(pageUrl)
      } catch (error) {
        lastError = error
      }
    }
  }

  // 被反爬拦下时先换爬虫 UA 直连原文页，比走镜像更完整
  for (const ua of CRAWLER_FALLBACK_UAS) {
    try {
      return await tryExtract(originUrl, ua)
    } catch (error) {
      lastError = error
    }
  }

  // 出版社反爬时，经 Google 翻译镜像再试（英文 / 中文各一）
  const translateLangs = /[\u4e00-\u9fff]/.test(`${article.title}\n${article.summary}`)
    ? (['zh-CN', 'en'] as const)
    : (['en', 'zh-CN'] as const)
  for (const tl of translateLangs) {
    const translateUrl = googleTranslateProxyUrl(originUrl, tl)
    if (!translateUrl || tried.has(translateUrl)) continue
    tried.add(translateUrl)
    try {
      return await tryExtract(translateUrl)
    } catch (error) {
      lastError = error
    }
  }

  // When the publisher cannot be read, retain usable syndication content.
  // Mark an unproven description as an excerpt rather than claiming it is full.
  if (
    availableFeedHtml &&
    !hasBrokenTextEncoding(availableFeedHtml) && !isPartialFeedTeaser(availableFeedHtml) &&
    (stripTags(availableFeedHtml).length >= 12 || /<(?:img|video|audio)\b/i.test(availableFeedHtml))
  ) {
    return renderFeed(true)
  }

  // Publisher extraction really failed and the syndication text is absent or
  // an explicit teaser. Do not assert a paywall without a positive signal.
  if (resolvedOriginUrl || article.summary?.trim()) {
    return buildBlockedPublisherFallback(article, resolvedOriginUrl)
  }

  throw lastError instanceof Error ? lastError : new Error('正文抽取失败')
}
