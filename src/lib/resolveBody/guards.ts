/**
 * 正文可用性判定：反爬/付费墙识别、爬虫 UA 兜底表、
 * 摘要 Feed 识别与快讯放行、软降级正文构造。
 */

import { findSource } from '../../sources/registry'
import type { Article } from '../types'
import { escapeHtml, stripTags, type ResolvedBody } from './shared'

/**
 * 出版社对普通浏览器 UA 常回 401/403 挑战页，却为了社交分享卡片对爬虫 UA
 * 放行完整 HTML（Reuters 只认 Discordbot、ESPN/Yahoo 认 facebook/twitter）。
 * 直连失败后按此顺序换 UA 重试原文页。
 */
export const CRAWLER_FALLBACK_UAS = [
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)',
  'Twitterbot/1.0',
  'Googlebot-News',
] as const

/**
 * NYT 等站对爬虫 UA 返回 200，但正文由前端渲染，HTML 里只剩一段
 * 「禁止自动化抓取」声明——字数够长会被误当正文。
 */
export function isScrapeNoticeBody(html: string): boolean {
  const text = stripTags(html)
  // NYT 声明页经 Readability 约 750 字；正常正文普遍在 1200 字以上
  if (text.length > 1200) return false
  return /data\s+mine\s+or\s+scrape\s+the\s+content|prohibited\s+without\s+prior\s+written\s+permission/i.test(
    text,
  )
}

/** 付费墙 / 反爬挑战页 / 翻译镜像拒绝页：不可当正文 */
export function isBlockedPublisherHtml(html: string): boolean {
  const head = html.slice(0, 8000)
  if (/<title[^>]*>\s*Simple Page\s*<\/title>/i.test(head)) return true
  if (/please enable js and disable any ad blocker/i.test(head)) return true
  if (/can'?t translate this page/i.test(head)) return true
  if (/just a moment\.\.\./i.test(head) && /cf-browser-verification|challenge-platform/i.test(head)) {
    return true
  }
  // 36kr 等站裸域常见：无 <title> 的 JS 挑战壳（浏览器能过，站内 fetch 不行）
  if (
    !/<title[\s>]/i.test(head) &&
    /_0x[0-9a-f]{3,}\s*\(/i.test(head) &&
    /spinner|conic-gradient/i.test(head)
  ) {
    return true
  }
  // 微信公众号环境验证壳：数据中心 IP 抓 /s?__biz=… 常返回 secitptpage/verify 空壳页
  if (/secitptpage\/verify/i.test(head) || /环境异常[\s\S]{0,40}完成验证/.test(head)) {
    return true
  }
  return false
}

/**
 * 部分站点裸域对无 JS 客户端返回反爬壳，www 才有正文/RSS。
 * 正文抓取前先规范化，避免误判成「付费墙」。
 */
export function preferPublisherFetchUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.hostname === '36kr.com') {
      parsed.hostname = 'www.36kr.com'
      return parsed.toString()
    }
  } catch {
    // 非法 URL 保持原样
  }
  return url
}

export function buildBlockedPublisherFallback(
  article: Article,
  resolvedOriginUrl?: string,
): ResolvedBody {
  const summary = article.summary?.trim()
  const note =
    '<p><strong>原站暂不支持站内阅读</strong>（付费墙或反爬拦截）。完整正文请点右上角在浏览器打开。</p>'
  const summaryHtml =
    summary && summary.length >= 40
      ? `<p>${escapeHtml(summary)}</p>`
      : '<p class="text-paper-muted">订阅源未提供可用摘要。</p>'
  return {
    contentHtml: `${note}${summaryHtml}`,
    bodySource: 'blocked',
    resolvedOriginUrl,
  }
}

/** 测试导出：付费墙/反爬软降级正文 */
export function buildBlockedPublisherFallbackForTest(
  article: Article,
  resolvedOriginUrl?: string,
): ResolvedBody {
  return buildBlockedPublisherFallback(article, resolvedOriginUrl)
}

/**
 * 英文站 RSS 常见「摘要 + 阅读全文」尾巴。命中则绝不当作站内全文，
 * 否则会跳过 Readability，只显示两段 teaser（如 Ars / Verge）。
 */
const PARTIAL_FEED_CTA =
  /read\s+(?:the\s+)?full\s+(?:story|article|post)|continue\s+reading|view\s+(?:the\s+)?full\s+article|阅读全文|查看全文|点击查看全文/i

/** 是否像「摘要 Feed」（带阅读全文 CTA），用于丢弃误缓存 */
export function isPartialFeedTeaser(html?: string): boolean {
  if (!html) return false
  return PARTIAL_FEED_CTA.test(stripTags(html))
}

/** Feed 自带内容是否已足够作为站内全文 */
export function isSubstantialHtml(html?: string): boolean {
  if (!html) return false
  const text = stripTags(html)
  if (!text) return false
  if (isPartialFeedTeaser(html)) return false
  // 纯文本与 HTML 统一看字数；不能仅凭「≥2 个 <p>」判定——摘要 Feed 也常有两三段
  return text.length >= 800
}

const INLINE_FLASH_KINDS = new Set(['cls', 'eastmoney-kx', 'wscn-live'])

/** 财经快讯：列表已带正文，即使短于 substantial 阈值也直接渲染 */
export function isInlineFlashBody(html: string | undefined, sourceId: string): boolean {
  if (!html) return false
  const source = findSource(sourceId)
  if (!source || !INLINE_FLASH_KINDS.has(source.kind)) return false
  return stripTags(html).length >= 12
}
