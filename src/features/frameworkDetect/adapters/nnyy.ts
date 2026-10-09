import type { FrameworkHint } from '../types'
import { extractCategoryLinks } from './shared'

const NNYY_CATEGORY_RE =
  /<a\b[^>]+href=["']([^"']*\/(?:dianying|dianshiju|zongyi|dongman)\/)["'][^>]*>([\s\S]*?)<\/a>/gi

/**
 * 努努影院（nnyy.in）自研模板：movie.css + /so 搜索 + 分类伪静态 + /_gp/ 播放 API。
 */
export function detectNnyy(html: string, pageUrl: string): FrameworkHint | null {
  const hasMovieCss = /\/static\/css\/movie\.css/i.test(html)
  const hasNnyyStatic = /\/static\/nnyy\//i.test(html)
  const hasSearchForm = /<form[^>]+action=["']\/so["']/i.test(html)
  const hasNavLists = /class="lists lists-thumb-top/i.test(html)

  if (!hasMovieCss && !hasNnyyStatic) return null
  if (!hasSearchForm && !hasNavLists) return null

  const base = new URL(pageUrl)
  const categories = extractCategoryLinks(html, pageUrl, [NNYY_CATEGORY_RE]).filter(
    (item) => item.title !== '首页' && !/^更多/.test(item.title),
  )

  return {
    framework: 'nnyy',
    themeVariant: 'movie',
    paginationPattern: { kind: 'query-param', param: 'page' },
    categories: categories.length > 0 ? categories : undefined,
    searchTemplate: `${base.origin}/so?q={query}`,
  }
}

/** 详情页 /dianying/123.html → 列表 /dianying/ */
export function nnyyListingUrlForDetail(pageUrl: string): string | undefined {
  try {
    const url = new URL(pageUrl)
    const match = url.pathname.match(/^\/(dianying|dianshiju|zongyi|dongman)\/\d+\.html$/i)
    if (!match) return undefined
    return `${url.origin}/${match[1]}/`
  } catch {
    return undefined
  }
}

export function isNnyyDetailUrl(pageUrl: string): boolean {
  try {
    return /^\/(dianying|dianshiju|zongyi|dongman)\/\d+\.html$/i.test(new URL(pageUrl).pathname)
  } catch {
    return false
  }
}
