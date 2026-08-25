/**
 * 公众号解析器（kind `wechat`）：镜像 RSS（wechat2rss）与公开合集 JSON 两种载荷。
 * 调研与取舍见 docs/superpowers/specs/2026-08-25-wechat-account-stream-research.md。
 */

import { cleanSummaryText } from '../cleanSummary'
import type { NewsSource } from '../../sources/registry'
import type { Article } from '../types'
import { parseXmlFeed } from './generic'
import {
  asRecord,
  buildArticle,
  firstImageIn,
  stripTags,
  text,
  toArray,
  type Unknown,
} from './shared'

/**
 * 公众号正文的已知模板噪声（wechat2rss 镜像 feed 与 mp.weixin.qq.com 页面共用）：
 * - 头部「原创 <作者> <YYYY-MM-DD HH:MM> <地点>」meta 行（镜像模板）
 * - 尾部「跳转微信打开」link-proxy 链接（镜像模板）
 * - 隐藏的 <mp-style-type> 排版标记（微信编辑器产物，原文页里也有）
 */
export function cleanWechatArticleHtml(html: string): string {
  let out = html

  const lead = out.match(/^\s*<p\b[^>]*>([\s\S]{0,600}?)<\/p>/)
  if (lead) {
    const leadText = stripTags(lead[1])
    // meta 行很短且必含「YYYY-MM-DD HH:MM」发布时间；正文首段不会同时满足
    if (leadText.length <= 80 && /\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}/.test(leadText)) {
      out = out.slice((lead.index ?? 0) + lead[0].length)
    }
  }

  return out
    .replace(/<p\b[^>]*>\s*<mp-style-type\b[^>]*>[\s\S]*?<\/mp-style-type>\s*<\/p>/gi, '')
    .replace(/<mp-style-type\b[^>]*>[\s\S]*?<\/mp-style-type>/gi, '')
    .replace(/<p\b[^>]*>\s*<a\b[^>]*>\s*跳转微信打开\s*<\/a>\s*<\/p>\s*$/i, '')
    .trim()
}

/**
 * 公众号镜像 feed（wechat2rss，过渡列表数据源）：标准 RSS + content:encoded 全文
 * （占 feed 体积 98–99%，实测 0.7–2.9MB/20 条）。信息流与正文分离：全文只用来派生
 * 摘要与封面，不进列表条目；正文由 resolveBody 按需直连 mp.weixin.qq.com 文章页
 * 抽取（extractWechatBodyHtml），bodyCache 承接已读缓存。
 */
function parseWechatMirrorFeed(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  return parseXmlFeed(source, payload, fetchedAt).map((article) => {
    if (!article.contentHtml) return article
    const cleaned = cleanWechatArticleHtml(article.contentHtml)
    // 清洗后没剩标签说明全文形态异常，仍从原始全文取摘要素材
    const summarySource = cleaned.includes('<') ? cleaned : article.contentHtml

    const summaryText = stripTags(summarySource)
    const cleanedSummary = cleanSummaryText(summaryText, article.title)
    return {
      ...article,
      contentHtml: undefined,
      summary: (cleanedSummary || summaryText).slice(0, 220),
      image: article.image ?? firstImageIn(summarySource),
    }
  })
}

/**
 * 公众号公开合集（mp.weixin.qq.com/mp/appmsgalbum + f=json）：
 * getalbum_resp.article_list 携带标题 / 原文链接 / 秒级时间戳 / 封面，正文不随列表下发，
 * 打开条目时由 resolveBody 直连文章页抽取。ret 非 0（参数错误 / 合集不可见）返回空列表。
 */
function parseWechatAlbum(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  let data: Unknown
  try {
    data = JSON.parse(payload) as Unknown
  } catch {
    return []
  }

  const baseResp = asRecord(data.base_resp)
  if (baseResp && Number(text(baseResp.ret) || '0') !== 0) return []

  const resp = asRecord(data.getalbum_resp)
  if (!resp) return []

  const articles: Article[] = []
  for (const raw of toArray(resp.article_list)) {
    const node = asRecord(raw)
    if (!node) continue
    const title = text(node.title)
    const link = text(node.url).replace(/^http:\/\//i, 'https://')
    if (!title || !link.startsWith('https://')) continue

    // create_time 为 unix 秒；缺失时留空走 fetchedAt
    const createTime = Number(text(node.create_time))
    const dateRaw =
      Number.isFinite(createTime) && createTime > 0
        ? new Date(createTime * 1000).toISOString()
        : ''

    const cover =
      text(node.cover_img_1_1) ||
      text(node.cover_img_url_1_1) ||
      text(node.cover_img_url) ||
      text(node.cover_url)

    const article = buildArticle(
      source,
      {
        title,
        link,
        html: '',
        summaryText: '',
        dateRaw,
        image: cover.replace(/^http:\/\//i, 'https://') || undefined,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}

/**
 * 公众号解析器（kind `wechat`）：按响应载荷分流——
 * JSON 视为公开合集接口，其余按镜像 RSS 解析。
 */
export function parseWechatSource(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  if (payload.trim().startsWith('{')) {
    return parseWechatAlbum(source, payload, fetchedAt)
  }
  return parseWechatMirrorFeed(source, payload, fetchedAt)
}
