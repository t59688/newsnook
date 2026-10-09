import type { CatalogItem } from '../types'
import {
  absoluteUrl,
  isLikelyBadgeTitle,
  isLikelyNavTitle,
  isUtilityPath,
  looksLikeDetailUrl,
  normalizeCatalogTitle,
  pathPattern,
  pickBetterCatalogTitle,
  sameOrigin,
  stripTags,
} from '../normalize'

const MIN_ITEMS = 3
const MIN_PATTERN_COUNT = 2
const MAX_ITEMS = 80

interface RawCard {
  originUrl: string
  title: string
  image?: string
  pattern: string
  score: number
  order: number
}

function attrValue(attrs: string, name: string): string | undefined {
  const match = attrs.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return match?.slice(1).find(Boolean)?.trim()
}

/** MacCMS / 懒加载常见：src 先放 1×1 data URI 或空白图，真图在 data-src。 */
function isPlaceholderImageSrc(src: string): boolean {
  const value = src.trim().toLowerCase()
  if (!value) return true
  if (value.startsWith('data:')) return true
  return /(?:^|[/?&=._-])(?:placeholder|blank|spacer|transparent|lazy|loading|pixel|1x1)(?:[/?&=._-]|$)/i.test(
    value,
  )
}

function pickImage(inner: string, baseUrl: string): string | undefined {
  for (const match of inner.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0]
    // Prefer lazy-load attrs over src: many CMS pages put a data: GIF in src.
    const candidates = [
      attrValue(tag, 'data-src'),
      attrValue(tag, 'data-original'),
      attrValue(tag, 'data-lazy-src'),
      attrValue(tag, 'data-url'),
      attrValue(tag, 'src'),
    ]
    for (const candidate of candidates) {
      if (!candidate || isPlaceholderImageSrc(candidate)) continue
      const abs = absoluteUrl(candidate, baseUrl)
      if (abs) return abs
    }
  }

  for (const match of inner.matchAll(/background-image:\s*url\((['"]?)([^'")]+)\1\)/gi)) {
    const raw = match[2] ?? ''
    if (isPlaceholderImageSrc(raw)) continue
    const abs = absoluteUrl(raw, baseUrl)
    if (abs) return abs
  }

  return undefined
}

function extractTitleFromInner(inner: string): string | undefined {
  const heading = inner.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1]
  if (heading) {
    const title = normalizeCatalogTitle(stripTags(heading))
    if (title.length >= 2 && title.length <= 80 && !isLikelyBadgeTitle(title)) return title
  }
  return undefined
}

function extractAnchorTitle(attrs: string, inner: string): string {
  const fromHeading = extractTitleFromInner(inner)
  if (fromHeading) return fromHeading

  const imgAlt = inner.match(/<img\b[^>]*>/i)?.[0]
  const altText = imgAlt ? attrValue(imgAlt, 'alt') : undefined

  const raw =
    stripTags(attrValue(attrs, 'title') || attrValue(attrs, 'aria-label') || '') ||
    stripTags(altText || '') ||
    stripTags(inner)

  return normalizeCatalogTitle(raw)
}

function mergeCards(existing: RawCard, incoming: RawCard): RawCard {
  const title = pickBetterCatalogTitle(existing.title, incoming.title)
  return {
    ...existing,
    image: incoming.image || existing.image,
    title,
    score: Math.max(existing.score, incoming.score),
  }
}

function scoreCard(card: Omit<RawCard, 'score' | 'order'>, order: number): RawCard {
  let score = 0
  if (card.image) score += 4
  if (card.title.length >= 8) score += 2
  if (card.title.length >= 16) score += 1
  if (looksLikeDetailUrl(card.originUrl)) score += 3
  if (isUtilityPath(card.originUrl)) score -= 8
  if (card.title.length > 120) score -= 2
  return { ...card, score, order }
}

function extractAnchorBlocks(html: string, pageUrl: string): RawCard[] {
  const cards = new Map<string, RawCard>()
  let order = 0

  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = match[1] ?? ''
    const inner = match[2] ?? ''
    const href = attrValue(attrs, 'href')
    if (!href) continue

    const originUrl = absoluteUrl(href, pageUrl)
    if (!originUrl || !sameOrigin(originUrl, pageUrl)) continue

    const key = originUrl.toLowerCase()
    if (isUtilityPath(originUrl)) continue

    try {
      const parsed = new URL(originUrl)
      if (parsed.href === pageUrl || parsed.pathname === new URL(pageUrl).pathname && !parsed.search) {
        continue
      }
    } catch {
      continue
    }

    const title = extractAnchorTitle(attrs, inner)
    const image = pickImage(inner, originUrl)
    if (isLikelyNavTitle(title)) continue
    if (isLikelyBadgeTitle(title) && !image) continue
    if (!image && (!title || title.length < 2)) continue

    const pattern = pathPattern(originUrl)
    if (!pattern) continue

    const card = scoreCard(
      {
        originUrl,
        title: isLikelyBadgeTitle(title) ? '' : title,
        image,
        pattern,
      },
      order++,
    )

    const existing = cards.get(key)
    if (existing) {
      cards.set(key, mergeCards(existing, card))
    } else {
      cards.set(key, card)
    }
  }

  return [...cards.values()]
}

/**
 * 启发式卡片：从公开 DOM 识别重复条目（阅读器重排版，非爬虫规则）。
 * 按路径模式聚类 + 打分，取主模式下的链接作为目录。
 */
export function extractHeuristicCardCatalog(html: string, pageUrl: string): CatalogItem[] {
  const raw = extractAnchorBlocks(html, pageUrl)
  if (raw.length < MIN_ITEMS) return []

  const patternStats = new Map<string, { count: number; score: number }>()
  for (const card of raw) {
    const stat = patternStats.get(card.pattern) ?? { count: 0, score: 0 }
    stat.count += 1
    stat.score += card.score
    patternStats.set(card.pattern, stat)
  }

  const rankedPatterns = [...patternStats.entries()]
    .map(([pattern, stat]) => ({
      pattern,
      count: stat.count,
      avgScore: stat.score / stat.count,
    }))
    .filter(
      (entry) =>
        entry.count >= MIN_PATTERN_COUNT ||
        (entry.count >= MIN_ITEMS && entry.avgScore >= 5) ||
        (entry.count >= MIN_ITEMS && looksLikeDetailUrl(entry.pattern)),
    )
    .sort((a, b) => b.count * b.avgScore - a.count * a.avgScore)

  if (!rankedPatterns.length) return []

  const top = rankedPatterns[0]
  const patternSet = new Set<string>([top.pattern])
  if (rankedPatterns[1] && rankedPatterns[1].count >= MIN_PATTERN_COUNT) {
    patternSet.add(rankedPatterns[1].pattern)
  }

  const filtered = raw
    .filter((card) => patternSet.has(card.pattern) && card.title.length >= 2)
    .sort((a, b) => a.order - b.order)

  if (filtered.length < MIN_ITEMS) return []

  return filtered.slice(0, MAX_ITEMS).map((card, index) => ({
    id: `heuristic-${index}`,
    title: card.title.slice(0, 200),
    originUrl: card.originUrl,
    image: card.image,
    summary: card.title.slice(0, 220),
  }))
}
