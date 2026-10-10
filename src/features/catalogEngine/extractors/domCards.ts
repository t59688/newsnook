import { parseHTML } from 'linkedom'
import { absoluteUrl, isUtilityPath, normalizeCatalogTitle, parseIsoDate, stripTags } from '../normalize'
import type { CatalogItem } from '../types'

export function catalogDocument(html: string): Document {
  const document = parseHTML(/<html\b/i.test(html) ? html : `<html><head></head><body>${html}</body></html>`).document as unknown as Document
  // linkedom preserves attribute case; real HTML documents normalize it.
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      if (name === attribute.name) continue
      element.removeAttribute(attribute.name)
      if (!element.hasAttribute(name)) element.setAttribute(name, attribute.value)
    }
  }
  return document
}

export function catalogBaseUrl(doc: Document, pageUrl: string): string {
  const raw = doc.querySelector('base[href]')?.getAttribute('href')
  const candidate = raw && absoluteUrl(raw, pageUrl)
  return candidate && new URL(candidate).origin === new URL(pageUrl).origin ? candidate : pageUrl
}

function imageIn(card: Element, baseUrl: string): string | undefined {
  const img = card.querySelector('img')
  const picture = card.querySelector('source[srcset]')
  const candidates = ['data-src', 'data-original', 'data-lazy-src', 'data-url', 'src'].map((key) => img?.getAttribute(key))
  candidates.push((img?.getAttribute('srcset') ?? picture?.getAttribute('srcset'))?.split(',')[0]?.trim().split(/\s+/)[0])
  const style = card.getAttribute('style') ?? card.querySelector('[style*="background-image"]')?.getAttribute('style')
  candidates.push(style?.match(/background-image:\s*url\(['"]?([^'")]+)/i)?.[1])
  return candidates.map((raw) => raw && !/^(?:data:|about:)|(?:blank|placeholder|loading|spacer)\./i.test(raw) ? absoluteUrl(raw, baseUrl) : undefined).find(Boolean)
}

/** Semantic/card containers keep slug URLs and sibling metadata together. */
export function extractDomCards(html: string, pageUrl: string, document?: Document): CatalogItem[] {
  const doc = document ?? catalogDocument(html)
  const baseUrl = catalogBaseUrl(doc, pageUrl)
  const groups = new Map<Element, CatalogItem[]>()
  const containers = doc.querySelectorAll('article, li, .card, .post, .entry, .vod-item, .module-item, .public-list-box, .views-row, .blog-item, .com-content-category-blog__item, [itemprop="itemListElement"]')
  let count = 0
  for (const card of containers) {
    if (card.closest('nav, header, footer, aside, [role="navigation"], .rank-group, .panel-aside, .sidebar, .post-meta, .entry-meta, .article-meta, [itemprop="author"], .pagination, .breadcrumbs, .related, .related-posts, .related-articles, .recommendations, .recommended')) continue
    if (card.querySelector('article, .card, .module-item') || [...card.querySelectorAll('li')].some((item) => item.querySelector('h2 a[href], h3 a[href], h4 a[href], h5 a[href], a[title][href], a[href] img'))) continue
    const heading = card.querySelector('h2, h3, h4, h5, h6, [itemprop="name"], .title, .video-title, .views-field-title')
    const anchor = heading?.closest('a[href]') ?? heading?.querySelector('a[href]') ?? card.querySelector('a[title][href], a[href]')
    const rawHref = anchor?.getAttribute('href')
    const originUrl = rawHref && absoluteUrl(rawHref, baseUrl)
    if (!originUrl || new URL(originUrl).origin !== new URL(pageUrl).origin || isUtilityPath(originUrl)) continue
    if (originUrl === pageUrl || /\/(?:categories|tags|vodtype|type)\//i.test(new URL(originUrl).pathname)) continue
    const title = normalizeCatalogTitle(stripTags(heading?.textContent || anchor?.getAttribute('title') || card.querySelector('img')?.getAttribute('alt') || anchor?.textContent || ''))
    if (title.length < 2 || title.length > 200 || /^(?:首页|更多|下一页|上一页|登录|注册|搜索|高清|标清|立即播放|\d+)$/.test(title)) continue
    const image = imageIn(card, baseUrl)
    if (!heading && !image && card.tagName.toLowerCase() !== 'article') continue
    const summary = stripTags(card.querySelector('.summary, .excerpt, .description, .video-info p, .views-field-body, .field--name-body, .post-content p, p')?.textContent || title).slice(0, 220)
    const date = card.querySelector('time[datetime], [itemprop="datePublished"]')
    const publishedAt = parseIsoDate(date?.getAttribute('datetime') || date?.getAttribute('content') || date?.textContent || undefined)
    const videoEvidence = /\/(?:v|watch|video|voddetail|vodplay|dianying|dianshiju|vod\/(?:detail|play)(?:\/id)?)\//i.test(new URL(originUrl).pathname) || card.getAttribute('itemtype')?.includes('VideoObject') || card.closest('.stui-vodlist, .myui-vodlist, .vod-item') || card.querySelector('.video-info')
    const articleRoute = /\/(?:art\/(?:detail|read)|articles?|posts?|news)\//i.test(new URL(originUrl).pathname)
    const contentType = articleRoute ? 'article' : videoEvidence ? 'video' : card.tagName.toLowerCase() === 'article' || card.matches('.post, .entry, [itemtype*="Article"]') ? 'article' : undefined
    const item: CatalogItem = { id: `dom-${count++}`, originUrl, title, image, summary, publishedAt, contentType }
    const parent = card.parentElement
    if (!parent) continue
    const items = groups.get(parent) ?? []
    items.push(item)
    groups.set(parent, items)
    if (count >= 1000) break
  }
  const ranked = [...groups.entries()].sort(([a, left], [b, right]) => {
    const weight = (node: Element, n: number) => n + (node.closest('main, [role="main"]') ? 10000 : 0)
    return weight(b, right.length) - weight(a, left.length)
  })
  if (!ranked.length) return []
  const main = ranked[0][0].closest('main, [role="main"]')
  const listClass = ['thumbnail-group', 'stui-vodlist', 'myui-vodlist', 'module-items', 'post-list', 'article-list'].find((name) => ranked[0][0].classList.contains(name))
  const candidates = main
    ? ranked.filter(([node]) => node.closest('main, [role="main"]') === main).flatMap(([, items]) => items)
    : listClass ? ranked.filter(([node]) => node.classList.contains(listClass)).flatMap(([, items]) => items) : ranked[0][1]
  const unique = new Map<string, CatalogItem>()
  for (const item of candidates) if (!unique.has(item.originUrl)) unique.set(item.originUrl, item)
  return [...unique.values()]
}
