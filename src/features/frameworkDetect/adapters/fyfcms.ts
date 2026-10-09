import type { FrameworkHint, FrameworkSortOption } from '../types'
import { extractCategoryLinks } from './shared'

const FYFCMS_SORT_OPTIONS: FrameworkSortOption[] = [
  { key: 'default', label: '默认' },
  { key: 'time', label: '更新' },
  { key: 'hits', label: '热度' },
  { key: 'score', label: '评分' },
]

/**
 * 飞飞CMS (FYFCMS) — 老牌中文视频 CMS。
 *
 * 探测：模板路径、`ff_player` / `cms_player`、以及 `vod-read-id` 等飞飞路由。
 *
 * 默认 URL 规则：
 *   分类列表  index.php?s=/vod-show-id-ID.html
 *   翻页      index.php?s=/vod-show-id-ID-p-PAGE.html
 *   搜索      index.php?s=/vod-search-wd-{query}.html
 */
export function detectFyfcms(html: string, pageUrl: string): FrameworkHint | null {
  if (scoreFyfcms(html) < 6) return null

  const base = new URL(pageUrl)
  const themeVariant = detectFyfcmsThemeVariant(html)
  const categories = extractFyfcmsCategories(html, pageUrl)

  return {
    framework: 'fyfcms',
    themeVariant,
    paginationPattern: {
      kind: 'path-segment',
      template: `${base.origin}/index.php?s=/vod-show-id-0-p-{page}.html`,
    },
    categories: categories.length > 0 ? categories : undefined,
    searchTemplate: `${base.origin}/index.php?s=/vod-search-wd-{query}.html`,
    sortOptions: FYFCMS_SORT_OPTIONS,
  }
}

function scoreFyfcms(html: string): number {
  const signals: Array<[RegExp, number]> = [
    [/\/template\/feifeicms\//i, 8],
    [/\bvar\s+cms_player\s*=/, 6],
    [/\bff_player\b/, 6],
    [/\bfyfcms\b/i, 4],
    [/\bff_url\b/i, 3],
    [/\/vod-read-id-\d+/i, 4],
    [/\/vod-play-id-\d+/i, 4],
    [/\/vod-show-id-\d+/i, 3],
    [/\/vod-type-id-\d+/i, 3],
    [/\bvar\s+Root\s*=/, 2],
    [/\bvar\s+SitePath\s*=/, 2],
  ]
  return signals.reduce((sum, [pattern, weight]) => (pattern.test(html) ? sum + weight : sum), 0)
}

function detectFyfcmsThemeVariant(html: string): string | undefined {
  const pathMatch = html.match(/\/template\/feifeicms\/([^/"']+)\//i)
  if (pathMatch?.[1]) return pathMatch[1].toLowerCase()
  if (/stui-header__menu/i.test(html)) return 'stui-like'
  return undefined
}

function extractFyfcmsCategories(
  html: string,
  pageUrl: string,
): { title: string; url: string }[] {
  // 飞飞CMS 分类链接：/index.php?s=/vod-show-id-ID.html 或伪静态 /video/channel/ID
  return extractCategoryLinks(html, pageUrl, [
    /<a\b[^>]+href=["']([^"']*\/vod-show-id-\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<a\b[^>]+href=["']([^"']*index\.php\?s=\/vod-show-id-\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<a\b[^>]+href=["']([^"']*\/video\/channel\/\d+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<a\b[^>]+href=["']([^"']*\/vod-type-id-\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi,
  ])
}
