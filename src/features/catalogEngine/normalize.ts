export function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function absoluteUrl(raw: string, baseUrl: string): string | undefined {
  const cleaned = raw.trim().replace(/&amp;/g, '&')
  if (!cleaned || cleaned.startsWith('#') || /^javascript:/i.test(cleaned)) return undefined
  try {
    const url = new URL(cleaned, baseUrl)
    if (!/^https?:$/.test(url.protocol)) return undefined
    return url.href
  } catch {
    return undefined
  }
}

export function parseIsoDate(raw: string | undefined): number | undefined {
  if (!raw?.trim()) return undefined
  const ms = Date.parse(raw.trim())
  return Number.isFinite(ms) ? ms : undefined
}

export function sameOrigin(url: string, pageUrl: string): boolean {
  try {
    return new URL(url).origin === new URL(pageUrl).origin
  } catch {
    return false
  }
}

/** 将具体 id 段归一化，用于识别列表页重复卡片链接 */
export function pathPattern(url: string): string | undefined {
  try {
    const { pathname, searchParams } = new URL(url)
    const normalizedSearch = [...searchParams.entries()]
      .filter(([key]) => !/^(utm_|ref|fbclid|_)/i.test(key))
      .map(([key, value]) => {
        const v =
          /^\d+$/.test(value) || /^[0-9a-f-]{8,}$/i.test(value)
            ? ':id'
            : value.length > 24
              ? ':token'
              : value
        return `${key}=${v}`
      })
      .sort()
      .join('&')

    const normalizedPath = pathname
      .replace(/[0-9a-f]{8,}/gi, ':id')
      .replace(/\d+/g, ':n')
      .replace(/\/+$/, '') || '/'

    return normalizedSearch ? `${normalizedPath}?${normalizedSearch}` : normalizedPath
  } catch {
    return undefined
  }
}

export function isLikelyNavTitle(title: string): boolean {
  const t = title.trim().toLowerCase()
  if (!t || t.length > 80) return false
  return /^(home|index|login|sign in|register|about|contact|privacy|terms|next|prev|previous|more|menu|search|categories?|tags?|share|download|upload)$/.test(
    t,
  )
}

export function isUtilityPath(url: string): boolean {
  return /\/(?:login|register|signup|signin|privacy|terms|about|contact|help|faq|dmca|cdn-cgi)(?:\/|$|\?)/i.test(
    url,
  )
}

export function looksLikeDetailUrl(url: string): boolean {
  return /\/(?:video|watch|play|view|clip|episode|ep|v|media|archives|post|article|news|voddetail|vodplay|detail|item)s?(?:\/|$|[?#])/i.test(
    url,
  )
}

/** MacCMS ds3 等主题未替换的占位符、徽章文案 */
export function normalizeCatalogTitle(raw: string): string {
  return raw
    .replace(/votype_\d+type_name/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function isLikelyBadgeTitle(title: string): boolean {
  const t = title.trim()
  if (!t) return false
  if (/^(?:热映推荐|豆瓣热榜|更新至)/.test(t)) return true
  return /^(?:全\d+集|\d+集全|\d+)$/.test(t)
}

export function scoreCatalogTitle(title: string): number {
  let score = 0
  const len = title.trim().length
  if (len >= 2 && len <= 36) score += 4
  else if (len <= 60) score += 2
  else score -= 4
  if (/votype_|type_name/i.test(title)) score -= 8
  if (isLikelyBadgeTitle(title)) score -= 6
  if (/^\d+$/.test(title.trim())) score -= 5
  return score
}

export function pickBetterCatalogTitle(a: string, b: string): string {
  const left = normalizeCatalogTitle(a)
  const right = normalizeCatalogTitle(b)
  if (!left) return right
  if (!right) return left
  return scoreCatalogTitle(left) >= scoreCatalogTitle(right) ? left : right
}
