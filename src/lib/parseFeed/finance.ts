/**
 * 财经快讯类解析器：财联社电报、东方财富 7×24 / 专栏、华尔街见闻快讯。
 * 快讯列表自带正文，短于 substantial 阈值时由 resolveBody 的 isInlineFlashBody 放行。
 */

import type { NewsSource } from '../../sources/registry'
import type { Article } from '../types'
import {
  asRecord,
  buildArticle,
  preferHttpsAsset,
  stripTags,
  text,
  toArray,
  type Unknown,
} from './shared'

function escapePlainAsHtml(textValue: string): string {
  return textValue
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function flashHtml(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''
  if (trimmed.includes('<')) return trimmed
  return `<p>${escapePlainAsHtml(trimmed)}</p>`
}

function titleFromFlash(brief: string, content: string): string {
  const fromBrief = stripTags(brief)
  if (fromBrief) return fromBrief.slice(0, 120)
  const plain = stripTags(content)
  const bracket = plain.match(/^【([^】]+)】/)
  if (bracket?.[1]) return bracket[1].slice(0, 120)
  return plain.slice(0, 80) || '快讯'
}

/** 财联社电报：列表 JSON 自带正文 */
export function parseClsTelegraph(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  let data: Unknown
  try {
    data = JSON.parse(payload) as Unknown
  } catch {
    return []
  }
  const roll = toArray(asRecord(data.data)?.roll_data).map(asRecord).filter(Boolean) as Unknown[]
  const articles: Article[] = []
  for (const item of roll) {
    const id = text(item.id)
    const content = text(item.content) || text(item.brief)
    if (!id || !content) continue
    const title = titleFromFlash(text(item.brief), content)
    const ctime = Number(item.ctime)
    const dateRaw =
      Number.isFinite(ctime) && ctime > 0 ? new Date(ctime * 1000).toISOString() : ''
    const article = buildArticle(
      source,
      {
        title,
        link: `https://www.cls.cn/telegraph/${id}`,
        html: flashHtml(content),
        summaryText: stripTags(content),
        dateRaw,
        neteaseDocId: id,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }
  return articles
}

/** 东方财富 7×24：JSONP `var ajaxResult=...` */
export function parseEastmoneyKx(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const match = payload.match(/var\s+ajaxResult\s*=\s*(\{[\s\S]*\})\s*;?\s*$/)
  if (!match?.[1]) return []
  let data: Unknown
  try {
    data = JSON.parse(match[1]) as Unknown
  } catch {
    return []
  }
  const list = toArray(data.LivesList).map(asRecord).filter(Boolean) as Unknown[]
  const articles: Article[] = []
  for (const item of list) {
    const newsid = text(item.newsid)
    const title = text(item.title)
    const digest = text(item.digest) || title
    if (!newsid || !title) continue
    const article = buildArticle(
      source,
      {
        title,
        link: `https://finance.eastmoney.com/a/${newsid}.html`,
        html: flashHtml(digest),
        summaryText: stripTags(digest),
        dateRaw: text(item.showtime),
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }
  return articles
}

/** 东方财富专栏新闻列表（摘要；正文走 Readability） */
export function parseEastmoneyNews(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  let data: Unknown
  try {
    data = JSON.parse(payload) as Unknown
  } catch {
    return []
  }
  if (text(data.code) !== '1' && Number(data.code) !== 1) return []
  const list = toArray(asRecord(data.data)?.list).map(asRecord).filter(Boolean) as Unknown[]
  const articles: Article[] = []
  for (const item of list) {
    const title = text(item.title)
    const link = text(item.url) || text(item.articleUrl) || text(item.code_url)
    if (!title || !link) continue
    const summary = text(item.summary) || text(item.digest)
    const article = buildArticle(
      source,
      {
        title,
        link: preferHttpsAsset(link) ?? link,
        html: '',
        summaryText: summary,
        dateRaw: text(item.showTime) || text(item.publishTime) || text(item.showtime),
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }
  return articles
}

/** 华尔街见闻快讯：lives JSON */
export function parseWscnLive(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  let data: Unknown
  try {
    data = JSON.parse(payload) as Unknown
  } catch {
    return []
  }
  const items = toArray(asRecord(data.data)?.items).map(asRecord).filter(Boolean) as Unknown[]
  const articles: Article[] = []
  for (const item of items) {
    const id = text(item.id)
    const contentText = text(item.content_text) || stripTags(text(item.content))
    const htmlRaw = text(item.content) || contentText
    if (!id || !contentText) continue
    const title = titleFromFlash(text(item.title), contentText)
    const ts = Number(item.display_time) || Number(item.created_at)
    const dateRaw = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : ''
    const link = text(item.uri) || `https://wallstreetcn.com/livenews/${id}`
    const article = buildArticle(
      source,
      {
        title,
        link,
        html: flashHtml(htmlRaw),
        summaryText: contentText,
        dateRaw,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }
  return articles
}
