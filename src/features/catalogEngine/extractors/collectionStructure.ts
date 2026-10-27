import { absoluteUrl, isUtilityPath } from '../normalize'
import { isCatalogContentUrl, isPlaybackControlAnchor, PLAYBACK_CONTROL_CONTAINERS } from '../linkRoles'

/** Shared exclusions for primary extraction and its heuristic fallback. */
export const NON_CONTENT_REGIONS = 'nav, header, footer, aside, [role="navigation"], .rank-group, .panel-aside, .sidebar, .post-meta, .entry-meta, .article-meta, .byline, .author-info, .author-box, .author-bio, .entry-author, [itemprop="author"], .pagination, .breadcrumbs, .breadcrumb, .related, .related-posts, .related-articles, .recommendations, .recommended, .box-title-nav, .subnav, .sub-nav, .secondary-nav, .section-nav, .sub-menu, .submenu'
const CARD_SELECTORS = 'article, li, .card, .post, .entry, .thumbnail, .vod-item, .module-item, .public-list-box, .views-row, .blog-item, .com-content-category-blog__item, .details-info-min, [itemprop="itemListElement"]'

/** Infer the smallest owner of a matching title + poster pair, never a whole page. */
export function collectionCards(document: Document, baseUrl: string): Element[] {
  const cards = new Set<Element>(document.querySelectorAll(CARD_SELECTORS))
  for (const heading of document.querySelectorAll('h2, h3, h4, h5, h6, [itemprop="name"]')) {
    if (heading.closest(NON_CONTENT_REGIONS)) continue
    const titleLink = heading.closest('a[href]') ?? heading.querySelector('a[href]')
    const target = titleLink && absoluteUrl(titleLink.getAttribute('href') || '', baseUrl)
    if (!target || !isCatalogContentUrl(target) || isUtilityPath(target)) continue
    for (let node = heading.parentElement, depth = 0; node && depth < 3; node = node.parentElement, depth++) {
      if (node.matches('body, main, section, ul, ol, header, nav, article')) break
      const otherTitles = [...node.querySelectorAll('h2 a[href], h3 a[href], h4 a[href], h5 a[href], h6 a[href]')]
        .some(link => absoluteUrl(link.getAttribute('href') || '', baseUrl) !== target)
      if (otherTitles) break
      const poster = [...node.querySelectorAll('a[href]')].find(link =>
        absoluteUrl(link.getAttribute('href') || '', baseUrl) === target
        && (link.querySelector('img, picture') || link.hasAttribute('data-original') || link.hasAttribute('data-background') || /background-image|background\s*:/i.test(link.getAttribute('style') || '')),
      )
      if (poster) { cards.add(node); break }
    }
  }
  // Inferred div cards can interleave with known cards; always keep source order.
  return [...cards].sort((a, b) => a === b ? 0 : a.compareDocumentPosition(b) & 4 ? -1 : 1)
}

/** Numbered text collections are as valid as image cards, but navigation is not. */
export function rankedTextCards(document: Document, baseUrl: string): Set<Element> {
  const result = new Set<Element>()
  for (const list of document.querySelectorAll('ul, ol, [role="list"]')) {
    if (list.closest(NON_CONTENT_REGIONS) || list.closest(PLAYBACK_CONTROL_CONTAINERS)) continue
    const rows = [...list.children].filter(row => row.matches('li, [role="listitem"]'))
    if (rows.length < 3) continue
    const numbered = list.tagName === 'OL' || rows.every(row => {
      const marker = row.querySelector('.num, .rank, .rank-number, [data-rank]')
      return marker && /^\d{1,5}[.)、]?\s*$/.test(marker.textContent?.trim() || '')
    })
    if (!numbered) continue
    const eligible = rows.filter(row => {
      const anchors = [...row.querySelectorAll('a[href]')].filter(link => {
        const url = absoluteUrl(link.getAttribute('href') || '', baseUrl)
        const title = (link.getAttribute('title') || link.textContent || '').trim()
        return url && new URL(url).origin === new URL(baseUrl).origin && isCatalogContentUrl(url)
          && !isUtilityPath(url) && !isPlaybackControlAnchor(link) && /[^\d\s›»>→▶►.]/.test(title) && title.length >= 2
      })
      return anchors.length === 1
    })
    if (eligible.length !== rows.length) continue
    for (const row of eligible) result.add(row)
  }
  return result
}

export function primaryContentHtml(document: Document): string {
  const copy = document.cloneNode(true) as Document
  for (const node of copy.querySelectorAll(`${NON_CONTENT_REGIONS}, ${PLAYBACK_CONTROL_CONTAINERS}`)) node.remove()
  return copy.toString()
}
