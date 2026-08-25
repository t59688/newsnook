/**
 * 通用 feed 解析路径：RSS / Atom / RDF 与 JSON Feed。
 * 站点定制 kind 的解析器在同目录其它模块。
 */

import { XMLParser } from 'fast-xml-parser'

import type { NewsSource } from '../../sources/registry'
import type { Article } from '../types'
import {
  asRecord,
  audioUrlFromNode,
  buildArticle,
  imageOf,
  pick,
  stripTags,
  text,
  toArray,
  type Unknown,
} from './shared'

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  // 去掉命名空间，dc:date / content:encoded / media:thumbnail 都会被拍平
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
})

function linkOfAtomEntry(node: Unknown): string {
  const links = toArray(node.link)
  const records = links.map(asRecord).filter(Boolean) as Unknown[]
  const alternate = records.find((item) => {
    const rel = item['@_rel']
    return (rel === undefined || rel === 'alternate') && typeof item['@_href'] === 'string'
  })
  if (alternate) return String(alternate['@_href'])
  const anyHref = records.find((item) => typeof item['@_href'] === 'string')
  if (anyHref) return String(anyHref['@_href'])
  return text(node.link)
}

function parseJsonFeed(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const data = JSON.parse(payload) as Unknown
  const items = toArray(data.items)
  const articles: Article[] = []

  for (const raw of items) {
    const node = asRecord(raw)
    if (!node) continue
    const html =
      text(node.content_html) ||
      (text(node.content_text) ? `<p>${text(node.content_text)}</p>` : '')
    const summaryText =
      text(node.summary) ||
      text(node.content_text) ||
      stripTags(html)
    const link = text(node.url) || text(node.external_url) || text(node.id)
    const image = text(node.image) || imageOf(node, html)

    const article = buildArticle(
      source,
      {
        title: text(node.title),
        link,
        html,
        summaryText,
        dateRaw: text(node.date_published) || text(node.date_modified),
        image,
        audioUrl: audioUrlFromNode(node, html),
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}

function looksLikeJsonFeed(payload: string): boolean {
  const trimmed = payload.trim()
  if (!trimmed.startsWith('{')) return false
  try {
    const data = JSON.parse(trimmed) as Unknown
    return Array.isArray(data.items) && (typeof data.version === 'string' || Boolean(data.title))
  } catch {
    return false
  }
}

export function parseGenericFeed(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  if (looksLikeJsonFeed(payload)) {
    return parseJsonFeed(source, payload, fetchedAt)
  }
  return parseXmlFeed(source, payload, fetchedAt)
}

export function parseXmlFeed(source: NewsSource, payload: string, fetchedAt: number): Article[] {
  const document = parser.parse(payload) as Unknown
  const articles: Article[] = []

  const rss = asRecord(document.rss)
  const channel = asRecord(rss?.channel)
  const atom = asRecord(document.feed)
  const rdf = asRecord(document.RDF)

  const nodes: Unknown[] = []
  let isAtom = false

  if (channel) {
    nodes.push(...(toArray(channel.item).map(asRecord).filter(Boolean) as Unknown[]))
  } else if (atom) {
    isAtom = true
    nodes.push(...(toArray(atom.entry).map(asRecord).filter(Boolean) as Unknown[]))
  } else if (rdf) {
    nodes.push(...(toArray(rdf.item).map(asRecord).filter(Boolean) as Unknown[]))
  }

  for (const node of nodes) {
    const html = text(pick(node, 'encoded', 'content', 'description', 'summary'))
    const descriptionText = stripTags(
      text(pick(node, 'description', 'summary')) || html,
    )
    const link = isAtom ? linkOfAtomEntry(node) : text(node.link) || text(node.guid)
    const dateRaw = text(pick(node, 'pubDate', 'published', 'updated', 'date'))
    // 虎嗅官方 RSS 用自定义 <type>video_article</type> 标识视频稿，
    // description 只有一句导语，视频地址需要在打开正文时从详情接口补齐。
    const contentType =
      source.id === 'huxiu' && text(node.type).toLowerCase() === 'video_article'
        ? 'video'
        : undefined

    const article = buildArticle(
      source,
      {
        title: text(node.title),
        link,
        html,
        summaryText: descriptionText,
        dateRaw,
        image: imageOf(node, html),
        audioUrl: audioUrlFromNode(node, html),
        contentType,
      },
      fetchedAt,
    )
    if (article) articles.push(article)
  }

  return articles
}
