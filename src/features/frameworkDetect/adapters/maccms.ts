import type { FrameworkHint, FrameworkSortOption, PaginationPattern } from '../types'
import { extractCategoryLinks } from './shared'

const MACCMS_SORT_OPTIONS: FrameworkSortOption[] = [
  { key: 'default', label: '默认' },
  { key: 'time', label: '更新' },
  { key: 'hits', label: '热度' },
  { key: 'hits_day', label: '日榜' },
  { key: 'hits_week', label: '周榜' },
  { key: 'hits_month', label: '月榜' },
  { key: 'score', label: '评分' },
]

const MATCH_THRESHOLD = 6

/**
 * 在已拉取的 HTML 上打分，不额外请求 ajax/suggest。
 * 换主题 / 改掉 maccms 变量后，仍靠路由、播放器、AJAX 路径识别。
 */
export function detectMaccms(html: string, pageUrl: string): FrameworkHint | null {
  if (scoreMaccms(html) < MATCH_THRESHOLD) return null

  const base = new URL(pageUrl)
  const variant = detectMaccmsVariant(html)
  const categories = extractMaccmsNavCategories(html, pageUrl)
  const rewrite = usesRewriteRoutes(html, variant)

  let paginationPattern: PaginationPattern
  let searchTemplate: string

  if (rewrite) {
    paginationPattern = {
      kind: 'path-segment',
      template: `${base.origin}/vodshow/-------{page}---/`,
    }
    searchTemplate = /\/vodsearch\.html/i.test(html)
      ? `${base.origin}/vodsearch.html?wd={query}`
      : `${base.origin}/vodsearch/-------------/?wd={query}`
  } else {
    const pathBase = base.pathname.replace(/\.html$/i, '')
    paginationPattern = {
      kind: 'path-segment',
      template: `${base.origin}${pathBase}/page/{page}.html`,
    }
    searchTemplate = `${base.origin}/index.php/vod/search.html?wd={query}`
  }

  return {
    framework: 'maccms',
    themeVariant: variant,
    paginationPattern,
    categories: categories.length > 0 ? categories : undefined,
    searchTemplate,
    sortOptions: MACCMS_SORT_OPTIONS,
  }
}

function scoreMaccms(html: string): number {
  const signals: Array<[RegExp, number]> = [
    [/(?:var|let|const)\s+maccms\s*=/, 8],
    [/\bMacPlayer\.(?:Show|PlayUrl|Flag)\b/, 6],
    [/\bMacPlayer\b/, 4],
    [/\/(?:index\.php\/)?ajax\/(?:suggest|hits|score)\b/i, 5],
    [/\/vodshow\/[^"'<\s]*-{6,}[^"'<\s]*/i, 5],
    [/[?&]m=vod-(?:detail|play|type)-id-/i, 5],
    [/\/index\.php\/vod\//i, 3],
    [/\/vod\/(?:type|detail|play|show)\//i, 3],
    [/\/vod(?:detail|play|type)\/\d+/i, 3],
    [/\/static\/player\//i, 3],
    [/\/static\/js\/home\.js/i, 2],
    [
      /\b(?:hl-vod-list|hl-tabs|hl-col-|hl-nav|fed-pops-navbar|fed-col-|stui-pannel|stui-vodlist|stui-header|mxpro-vod|mytheme-)/i,
      2,
    ],
  ]
  return signals.reduce((sum, [pattern, weight]) => (pattern.test(html) ? sum + weight : sum), 0)
}

function usesRewriteRoutes(html: string, variant: MaccmsVariant): boolean {
  if (variant !== 'classic') return true
  return /\/vod(?:type|show|detail|search)(?:\/|\.html)/i.test(html) && !/\/index\.php\/vod\//i.test(html)
}

type MaccmsVariant = 'classic' | 'wntheme' | 'stui' | 'mxone' | 'mxpro' | 'conch' | 'ds3' | 'vfed'

function detectMaccmsVariant(html: string): MaccmsVariant {
  if (/\/static\/ds3\//.test(html) || /\/template\/ds3\//.test(html)) {
    return 'ds3'
  }
  if (/\/template\/wntheme\d*\//.test(html) || /var\s+wntheme\s*=/.test(html)) {
    return 'wntheme'
  }
  if (/\/template\/vfed\//i.test(html) || /vfed\.min\.js/i.test(html) || /fed-pops-navbar|fed-col-/i.test(html)) {
    return 'vfed'
  }
  if (
    /\/template\/stui_?\d*\//.test(html) ||
    /stui-header__menu|stui-pannel|stui-vodlist|stui-header/i.test(html)
  ) {
    return 'stui'
  }
  if (/\/template\/mxone\//.test(html) || /mxone-theme|mx-theme/.test(html)) {
    return 'mxone'
  }
  if (/\bmxpro-vod\b|\/template\/mxpro\//i.test(html) || /\bmytheme-/i.test(html)) {
    return 'mxpro'
  }
  if (/\/template\/conch\//.test(html) || /hl-vod-list|hl-nav|hl-tabs|hl-col-/i.test(html)) {
    return 'conch'
  }
  return 'classic'
}

function extractMaccmsNavCategories(
  html: string,
  pageUrl: string,
): { title: string; url: string }[] {
  const results = extractCategoryLinks(html, pageUrl, [
    /<a\b[^>]+href=["']([^"']*\/vod\/type\/id\/\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<a\b[^>]+href=["']([^"']*\/index\.php\/vod\/type\/id\/\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<a\b[^>]+href=["']([^"']*\/vodtype\/\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<a\b[^>]+href=["']([^"']*\/vodtype\/\d+\/)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<a\b[^>]+href=["']([^"']*\/type\/\d+\/)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<a\b[^>]+href=["']([^"']*\/vodshow\/\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<a\b[^>]+href=["']([^"']*\/vodshow\/\d+-{6,}[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<a\b[^>]+href=["']([^"']*[?&]m=vod-type-id-\d+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  ])
  return results.filter(
    (item) =>
      item.title !== '首页' &&
      !/^更多/.test(item.title) &&
      !/suggest|ajax/i.test(item.url),
  )
}
