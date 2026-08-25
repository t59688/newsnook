/**
 * 原文页 HTML → 站内正文抽取：Readability 主路径、
 * 现代博客 streaming 槽兜底、优设 / 公众号站点定制抽取。
 */

import { parseHTML } from 'linkedom'

import { buildPageLeadHtml, isSoftNotFoundHtml } from '../pageLead'
import { sanitizeArticleHtml } from '../sanitize'
import { cleanWechatArticleHtml } from '../parseFeed'
import {
  absolutizeHtml,
  escapeHtml,
  stripTags,
  type ResolvedBody,
} from './shared'

function removeEmbedChrome(document: Document): void {
  document
    .querySelectorAll(
      [
        '.o-em-consent',
        '.o-em-adblock',
        '[class*="em-consent"]',
        '[class*="em-adblock"]',
        // France 24 SPA 壳里常驻的软 404 / loader，去掉后才不会被 Readability 当成正文
        '.a-loader-wrapper',
        '.a-loader-error',
        '[data-loader-wrapper]',
      ].join(', '),
    )
    .forEach((node) => node.remove())
}

export function isLikelyVideoPageUrl(pageUrl: string): boolean {
  return /\/(?:video|videos|watch|embed|player)(?:\/|[?#]|$)/i.test(pageUrl)
}

function videoFallbackBody(pageHtml: string, title?: string): ResolvedBody {
  const lead = buildPageLeadHtml(pageHtml)
  const embeds = collectYoutubeEmbedHtml(pageHtml)
  const note = embeds
    ? ''
    : '<p>本条主要为视频内容，未能解析到可嵌入的播放器，请打开原文观看。</p>'
  return {
    contentHtml: sanitizeArticleHtml(`${lead}${embeds}${note}`),
    title,
    bodySource: 'readability',
  }
}

/** 原样收集页面中的 YouTube embed，不做转码/二次封装 */
export function collectYoutubeEmbedHtml(pageHtml: string): string {
  const matches = pageHtml.match(
    /<iframe\b[^>]*\bsrc=["']https:\/\/(?:www\.)?(?:youtube\.com|youtube-nocookie\.com)\/embed\/[^"']+["'][^>]*>[\s\S]*?<\/iframe>/gi,
  )
  if (!matches?.length) return ''
  const unique = [...new Set(matches)]
  return unique.join('')
}

/**
 * Readability 搞不定的现代博客（如 Arena Next.js）：
 * 正文常在 streaming 槽（#S:*）里，空的 <main> 没有段落，故扫整个 body。
 * YouTube 用原站 iframe，不改 src、不二次封装。
 */
async function extractMainContentFallback(
  pageHtml: string,
  pageUrl: string,
  title?: string,
): Promise<ResolvedBody | undefined> {
  const { document } = parseHTML(pageHtml)
  const root = document.body
  if (!root) return undefined

  root
    .querySelectorAll('header, footer, nav, form, script, style, noscript')
    .forEach((node) => node.remove())

  // 相关文章卡片（Read Article）会污染正文
  root.querySelectorAll('a').forEach((anchor) => {
    const label = (anchor.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase()
    if (label === 'read article' || label === 'see all articles') {
      const card = anchor.closest('article') || anchor.parentElement
      card?.remove()
    }
  })

  const blocks: string[] = []
  // 直接从原始 HTML 收 embed，避免 streaming 槽解析差异
  const embeds = collectYoutubeEmbedHtml(pageHtml)
  if (embeds) blocks.push(embeds)

  const seen = new Set<string>()
  root.querySelectorAll('h1, h2, h3, p, li, blockquote, pre, figcaption').forEach((node) => {
    const text = (node.textContent || '').replace(/\s+/g, ' ').trim()
    if (text.length < 24) return
    if (seen.has(text)) return
    // 跳过明显导航/页脚/订阅
    if (/^(back to|subscribe|follow|terms|privacy|cookies|try arena|insights at the frontier)/i.test(text)) {
      return
    }
    if (/^©\s*\d{4}/i.test(text)) return
    if (/^(leaderboard rankings|use cases|company|legal)$/i.test(text)) return
    seen.add(text)
    const tag = node.tagName.toLowerCase()
    if (tag === 'li') {
      blocks.push(`<li>${escapeHtml(text)}</li>`)
      return
    }
    if (tag === 'h1' || tag === 'h2' || tag === 'h3') {
      blocks.push(`<${tag}>${escapeHtml(text)}</${tag}>`)
      return
    }
    blocks.push(`<p>${escapeHtml(text)}</p>`)
  })

  // 把连续 li 包进 ul
  let html = blocks.join('\n')
  html = html.replace(/(?:<li>[\s\S]*?<\/li>\n?)+/g, (chunk) => `<ul>${chunk}</ul>`)

  const textLen = stripTags(html).length
  if (textLen < 200 && !embeds) return undefined

  return {
    contentHtml: await absolutizeHtml(html, pageUrl),
    title,
    bodySource: 'readability',
  }
}

/**
 * 优设正文：通用 Readability 会踩两个站内坑——
 * 1. 长文包在 `.post-article.uisdc-none` 里；类名含 `none`，被 Readability
 *    unlikelyCandidates 当成隐藏节点整段丢掉，只剩文内「阅读文章」卡片。
 * 2. 「优设9图」(`/group/`) 提示词在 `.group-singular-entry`，图集在兄弟节点
 *    `.group-singular-images`，Readability 只收文不收图。
 */
export function extractUisdcBodyHtml(pageHtml: string): string | undefined {
  const { document } = parseHTML(pageHtml)

  const groupEntry = document.querySelector('.group-singular-entry .entry')
  const groupImages = Array.from(
    document.querySelectorAll('.group-singular-images img'),
  )
  if (groupEntry || groupImages.length > 0) {
    const parts: string[] = []
    if (groupEntry) {
      const entryHtml = (groupEntry as { innerHTML?: string }).innerHTML?.trim()
      if (entryHtml) parts.push(entryHtml)
    }
    for (const img of groupImages) {
      const src =
        img.getAttribute('src')?.trim() ||
        img.getAttribute('data-src')?.trim() ||
        ''
      if (!src || src === ' ') continue
      const alt = img.getAttribute('alt') || ''
      parts.push(
        `<p><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"></p>`,
      )
    }
    const html = parts.join('\n').trim()
    if (html && (groupImages.length >= 1 || stripTags(html).length >= 40)) {
      return html
    }
  }

  const articleRoot =
    document.querySelector('.post-content-wrap .article') ||
    document.querySelector('.post-article .article') ||
    document.querySelector('.post-content .article')
  if (!articleRoot) return undefined

  // 文中插入的相关文卡片（「阅读文章 >」），不是正文
  articleRoot.querySelectorAll('.tuwen_link').forEach((node) => node.remove())
  const html = (articleRoot as { innerHTML?: string }).innerHTML?.trim()
  if (!html) return undefined
  if (stripTags(html).length < 40 && !(html.match(/<img\b/gi) || []).length) {
    return undefined
  }
  return html
}

function isUisdcPageUrl(pageUrl: string): boolean {
  try {
    const host = new URL(pageUrl).hostname.toLowerCase()
    return host === 'uisdc.com' || host.endsWith('.uisdc.com')
  } catch {
    return false
  }
}

/** 公众号文章页（/s/<slug> 与 /s?__biz=… 两种形态同域） */
export function isWechatArticleUrl(pageUrl: string): boolean {
  try {
    const parsed = new URL(pageUrl)
    return parsed.hostname === 'mp.weixin.qq.com' && parsed.pathname.startsWith('/s')
  } catch {
    return false
  }
}

/**
 * 公众号文章页正文：内容固定在 `#js_content`（.rich_media_content），
 * 容器带 `visibility: hidden` 内联样式、图片全部 data-src 懒加载——裸 Readability
 * 会受隐藏样式与占位图干扰，直接取容器 innerHTML 再走统一图片提升更稳。
 * 验证壳 / 已删除提示页没有 js_content，返回 undefined 交由通用链路兜底。
 */
export function extractWechatBodyHtml(pageHtml: string): string | undefined {
  const { document } = parseHTML(pageHtml)
  const root =
    document.querySelector('#js_content') ||
    document.querySelector('.rich_media_content')
  if (!root) return undefined

  const html = cleanWechatArticleHtml(
    ((root as { innerHTML?: string }).innerHTML ?? '').trim(),
  )
  if (!html) return undefined
  if (stripTags(html).length < 40 && !(html.match(/<img\b/gi) || []).length) {
    return undefined
  }
  return html
}

/** 公众号文章标题（og:title 优先，回退 #activity-name）；分享短链无标题时回填阅读器 */
export function extractWechatArticleTitle(pageHtml: string): string | undefined {
  const og = pageHtml.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/i)?.[1]?.trim()
  if (og) return og
  const { document } = parseHTML(pageHtml)
  const heading = document.querySelector('#activity-name')?.textContent?.trim()
  return heading || undefined
}

export async function extractWithReadability(
  pageHtml: string,
  pageUrl: string,
): Promise<ResolvedBody> {
  if (isUisdcPageUrl(pageUrl)) {
    const custom = extractUisdcBodyHtml(pageHtml)
    if (custom) {
      return {
        contentHtml: await absolutizeHtml(custom, pageUrl),
        bodySource: 'readability',
      }
    }
  }

  if (isWechatArticleUrl(pageUrl)) {
    const custom = extractWechatBodyHtml(pageHtml)
    if (custom) {
      return {
        contentHtml: await absolutizeHtml(custom, pageUrl),
        title: extractWechatArticleTitle(pageHtml),
        bodySource: 'readability',
      }
    }
  }

  const { Readability } = await import('@mozilla/readability')
  const { document } = parseHTML(pageHtml)
  removeEmbedChrome(document as unknown as Document)
  const reader = new Readability(document as unknown as Document, {
    charThreshold: 80,
  })
  const article = reader.parse()
  // 仅 URL 像视频频道时才走「视频兜底」；正文里夹带 YouTube ≠ 整页只有视频
  const isVideoPage = isLikelyVideoPageUrl(pageUrl)

  if (!article?.content || stripTags(article.content).length < 80) {
    const fallback = await extractMainContentFallback(
      pageHtml,
      pageUrl,
      article?.title ?? undefined,
    )
    if (fallback) return fallback
    if (isVideoPage) return videoFallbackBody(pageHtml, article?.title ?? undefined)
    throw new Error('无法从原文页抽取正文')
  }

  if (isSoftNotFoundHtml(article.content)) {
    const fallback = await extractMainContentFallback(
      pageHtml,
      pageUrl,
      article.title ?? undefined,
    )
    if (fallback) return fallback
    if (isVideoPage) return videoFallbackBody(pageHtml, article.title ?? undefined)
    const lead = buildPageLeadHtml(pageHtml)
    if (lead) {
      return {
        contentHtml: await absolutizeHtml(lead, pageUrl),
        title: article.title || undefined,
        bodySource: 'readability',
      }
    }
    throw new Error('无法从原文页抽取正文')
  }

  // Readability 常丢掉 iframe：把原站 YouTube embed 补回正文前部
  const embeds = collectYoutubeEmbedHtml(pageHtml)
  const merged = embeds && !/youtube\.com\/embed|youtube-nocookie\.com\/embed/i.test(article.content)
    ? `${embeds}${article.content}`
    : article.content

  const absolute = await absolutizeHtml(merged, pageUrl)
  if (stripTags(absolute).length < 80 || isSoftNotFoundHtml(absolute)) {
    const fallback = await extractMainContentFallback(
      pageHtml,
      pageUrl,
      article.title ?? undefined,
    )
    if (fallback) return fallback
    if (isVideoPage) return videoFallbackBody(pageHtml, article.title ?? undefined)
    throw new Error('无法从原文页抽取正文')
  }
  return {
    contentHtml: absolute,
    title: article.title || undefined,
    bodySource: 'readability',
  }
}
