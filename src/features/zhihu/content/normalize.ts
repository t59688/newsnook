import { parseHTML } from 'linkedom'

import { sanitizeArticleHtml } from '../../../lib/sanitize'
import type { ZhihuSegmentInfoParagraph } from '../api/decode'
import { injectZhihuSegmentHighlights } from '../segments/normalize'
import type { ZhihuEntityRef } from '../types'
import { parseZhihuVideoId } from './links'

const ZHIHU_HOSTS = new Set(['zhihu.com', 'www.zhihu.com', 'zhuanlan.zhihu.com'])
const VIDEO_HOST_PATTERN = /(?:^|\.)(?:bilibili\.com|b23\.tv|youtube\.com|youtu\.be|vimeo\.com|douyin\.com|ixigua\.com)$/i
const CARD_CLASS_PATTERN = /(?:video-box|link-card|link-box|external-link|content-link)/i

function isOnlyMeaningfulChild(parent: Element, anchor: Element): boolean {
  for (const node of [...parent.childNodes]) {
    if (node === anchor) continue
    if (node.nodeType === 3 && !(node.nodeValue || '').trim()) continue
    if (node.nodeType === 1 && (node as Element).tagName === 'BR') continue
    return false
  }
  return true
}

function resolveLinkUrl(href: string): URL | null {
  try {
    const raw = new URL(href)
    if (raw.protocol !== 'https:' && raw.protocol !== 'http:') return null
    if (raw.hostname === 'link.zhihu.com') {
      const target = raw.searchParams.get('target')
      if (target) {
        try {
          const decoded = new URL(target)
          if (decoded.protocol === 'https:' || decoded.protocol === 'http:') return decoded
        } catch {
          // Keep the safe Zhihu redirect when the target is malformed.
        }
      }
    }
    return raw
  } catch {
    return null
  }
}

function hasBlockLinkSemantics(anchor: Element): boolean {
  return CARD_CLASS_PATTERN.test(anchor.getAttribute('class') || '')
    || CARD_CLASS_PATTERN.test(anchor.getAttribute('data-draft-type') || '')
    || CARD_CLASS_PATTERN.test(anchor.getAttribute('data-type') || '')
    || anchor.querySelector('img') != null
}

function bestLinkTitle(anchor: Element, url: URL): string {
  const explicit = [
    anchor.getAttribute('data-title'),
    anchor.getAttribute('aria-label'),
    anchor.querySelector('[data-title]')?.getAttribute('data-title'),
    anchor.querySelector('[class*=title]')?.textContent,
    anchor.textContent,
  ].find((value) => value?.replace(/\s+/g, ' ').trim())
  const title = explicit?.replace(/\s+/g, ' ').trim()
  return title && title !== anchor.getAttribute('href') ? title : url.hostname.replace(/^www\./, '')
}

function createExternalCard(document: Document, source: Element, url: URL): Element {
  const isZhihuVideo = Boolean(parseZhihuVideoId(url.href))
  const isVideo = isZhihuVideo || VIDEO_HOST_PATTERN.test(url.hostname) || /video/i.test(source.getAttribute('class') || '')
  const label = isVideo ? '视频' : '外链'
  const detectedTitle = bestLinkTitle(source, url)
  const title = isZhihuVideo && (
    /^(?:www\.)?zhihu\.com$/i.test(detectedTitle)
    || detectedTitle === source.getAttribute('href')
  ) ? '知乎视频' : detectedTitle

  // 视频不能先落成可点击 <a> 再等 effect “抢占”替换。Android WebView/React
  // 任一生命周期差异都会把它永久留成链接卡片。这里直接输出稳定的视频宿主，
  // InlineVideoPages 只负责往宿主内部 portal 播放器，不再替换正文根节点。
  const card = document.createElement(isVideo ? 'div' : 'a')
  card.setAttribute('data-reader-role', isVideo ? 'zhihu-video-page' : 'zhihu-link-card')
  card.setAttribute('data-related-title', title)
  if (isVideo) {
    card.setAttribute('data-media-format', 'video-page')
    card.setAttribute('data-source-page', url.href)
  } else {
    card.setAttribute('href', url.href)
  }

  const image = source.querySelector('img[src]')
  if (image) {
    const preview = document.createElement('img')
    const src = image.getAttribute('src')
    if (src) preview.setAttribute('src', src)
    const alt = image.getAttribute('alt') || title
    preview.setAttribute('alt', alt)
    preview.setAttribute('data-reader-role', 'zhihu-link-image')
    card.append(preview)
  }

  const kind = document.createElement('span')
  kind.setAttribute('data-reader-role', 'zhihu-link-kind')
  kind.textContent = label

  const body = document.createElement('span')
  body.setAttribute('data-reader-role', 'zhihu-link-body')
  const titleNode = document.createElement('span')
  titleNode.setAttribute('data-reader-role', 'zhihu-link-title')
  titleNode.textContent = title
  const host = document.createElement('span')
  host.setAttribute('data-reader-role', 'zhihu-link-host')
  host.textContent = url.hostname.replace(/^www\./, '')
  body.append(titleNode, host)
  card.append(kind, body)
  return card
}

function safeImageCandidate(value: string | null | undefined): string | undefined {
  const candidate = value?.trim()
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : undefined
  } catch {
    return undefined
  }
}

function zhihuImageCandidates(image: Element): string[] {
  const values: Array<string | undefined> = [
    // data-actualsrc 是知乎正文当前展示图；original-* 作为直连失败后的备用源。
    safeImageCandidate(image.getAttribute('data-actualsrc')),
    safeImageCandidate(image.getAttribute('src')),
    safeImageCandidate(image.getAttribute('data-original-src')),
    safeImageCandidate(image.getAttribute('data-original')),
  ]
  const srcset = image.getAttribute('srcset')
  if (srcset) {
    for (const entry of srcset.split(',')) {
      values.push(safeImageCandidate(entry.trim().split(/\s+/, 1)[0]))
    }
  }
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}

/**
 * 正文图片不能在网络较慢时留下一个“空白洞”。
 * 这里给普通正文图补一个稳定占位层；真正的加载/成功/失败状态仍由
 * useProgressiveImages 接管，因此复用 Reader 的图片代理、渐显和失败判定。
 */
function wrapContentImages(rawHtml: string): string {
  if (!/<img\b/i.test(rawHtml)) return rawHtml
  try {
    const { document } = parseHTML(`<!doctype html><html><body>${rawHtml}</body></html>`)
    const images = [...document.body.querySelectorAll('img')]
    for (const image of images) {
      if (image.closest('[data-reader-role="zhihu-image-host"]')) continue
      if (image.getAttribute('data-reader-role') === 'zhihu-link-image') continue
      if (image.getAttribute('data-reader-role') === 'badge') continue
      if (image.closest('[data-reader-role="zhihu-link-card"], [data-reader-role="zhihu-video-page"]')) continue

      const candidates = zhihuImageCandidates(image)
      if (candidates[0]) image.setAttribute('src', candidates[0])
      image.removeAttribute('srcset')
      if (candidates.length > 1) {
        image.setAttribute('data-reader-image-fallbacks', JSON.stringify(candidates.slice(1)))
      }

      const host = document.createElement('span')
      host.setAttribute('data-reader-role', 'zhihu-image-host')

      const loading = document.createElement('span')
      loading.setAttribute('data-reader-role', 'zhihu-image-loading')
      loading.textContent = '图片加载中…'

      const failed = document.createElement('span')
      failed.setAttribute('data-reader-role', 'zhihu-image-failed')
      failed.textContent = '图片加载失败，点按重试'

      image.replaceWith(host)
      host.append(image, loading, failed)
    }
    return document.body.innerHTML
  } catch {
    return rawHtml
  }
}

/**
 * 知乎正文里站外视频/链接既有“整段一个 a”，也有 video-box / link-card 等块级结构。
 * NewsNook 在清洗前把它们统一成自己的语义卡片，然后仍交给 sanitizeArticleHtml 做最终安全过滤。
 */
function promoteStandaloneExternalLinks(rawHtml: string): string {
  if (!/<a\b/i.test(rawHtml)) return rawHtml
  try {
    const { document } = parseHTML(`<!doctype html><html><body>${rawHtml}</body></html>`)
    const anchors = [...document.body.querySelectorAll('a[href], a.video-box[data-lens-id]')]
    for (const anchor of anchors) {
      const href = anchor.getAttribute('href')?.trim()
      const lensId = anchor.getAttribute('data-lens-id')?.trim()
      const syntheticZhihuVideo = !href && lensId && /^[0-9]+$/.test(lensId)
        ? `https://www.zhihu.com/video/${lensId}`
        : undefined
      const url = resolveLinkUrl(href || syntheticZhihuVideo || '')
      if (!url) continue
      const isZhihuVideo = Boolean(parseZhihuVideoId(url.href))
      if (ZHIHU_HOSTS.has(url.hostname) && !isZhihuVideo) continue

      const parent = anchor.parentElement
      const standalone = Boolean(parent && /^(P|DIV|FIGURE)$/i.test(parent.tagName) && isOnlyMeaningfulChild(parent, anchor))
      const blockLink = hasBlockLinkSemantics(anchor)
      if (!standalone && !blockLink) continue

      const card = createExternalCard(document, anchor, url)
      if (standalone && parent) parent.replaceWith(card)
      else anchor.replaceWith(card)
    }
    return document.body.innerHTML
  } catch {
    return rawHtml
  }
}

/** 展示层清洗；编辑原始正文不得调用此函数覆盖源数据。 */
export function normalizeZhihuContentHtml(
  rawHtml: string,
  segmentInfos: ZhihuSegmentInfoParagraph[] = [],
  ref?: ZhihuEntityRef,
): string {
  if (!rawHtml.trim()) return ''
  const segmented = ref && segmentInfos.length > 0
    ? injectZhihuSegmentHighlights(rawHtml, segmentInfos, ref)
    : rawHtml
  return sanitizeArticleHtml(wrapContentImages(promoteStandaloneExternalLinks(segmented)))
}
