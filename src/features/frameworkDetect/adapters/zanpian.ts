import type { FrameworkHint, FrameworkSortOption } from '../types'
import { extractCategoryLinks } from './shared'

const ZANPIAN_SORT_OPTIONS: FrameworkSortOption[] = [
  { key: 'default', label: '默认' },
  { key: 'time', label: '更新' },
  { key: 'hits', label: '热度' },
  { key: 'hits_day', label: '日榜' },
  { key: 'hits_week', label: '周榜' },
  { key: 'hits_month', label: '月榜' },
  { key: 'score', label: '评分' },
]

/**
 * 赞片CMS (ZanPian) — 视频聚合站 CMS。
 *
 * 探测信号：全局变量 `var zanpian` 或页面含 `zanpian` 标识。
 *
 * URL 规则类似 MacCMS：
 *   分类列表  /vodtype/ID/ 或 /vod/type/id/ID.html
 *   搜索      /vodsearch?wd={query} 或 /index.php/vod/search.html?wd={query}
 *   翻页      path-segment
 */
export function detectZanpian(html: string, pageUrl: string): FrameworkHint | null {
  if (!/var\s+zanpian\s*=/.test(html) && !/zanpiancms/i.test(html)) return null

  const base = new URL(pageUrl)
  const themeVariant = detectZanpianThemeVariant(html)
  const categories = extractZanpianCategories(html, pageUrl)
  const pathBase = base.pathname.replace(/\.html$/i, '')

  return {
    framework: 'zanpian',
    themeVariant,
    paginationPattern: {
      kind: 'path-segment',
      template: `${base.origin}${pathBase}/page/{page}.html`,
    },
    categories: categories.length > 0 ? categories : undefined,
    searchTemplate: `${base.origin}/index.php/vod/search.html?wd={query}`,
    sortOptions: ZANPIAN_SORT_OPTIONS,
  }
}

function detectZanpianThemeVariant(html: string): string | undefined {
  if (/\/template\/stui\//i.test(html) || /stui-header__menu/i.test(html)) {
    return 'stui'
  }
  if (/\/template\/default\//i.test(html)) {
    return 'default'
  }
  return undefined
}

function extractZanpianCategories(
  html: string,
  pageUrl: string,
): { title: string; url: string }[] {
  // 赞片 CMS 分类链接格式与 MacCMS 相似
  return extractCategoryLinks(html, pageUrl, [
    /<a\b[^>]+href=["']([^"']*\/vodtype\/\d+\/)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<a\b[^>]+href=["']([^"']*\/vod\/type\/id\/\d+\.html)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<a\b[^>]+href=["']([^"']*\/type\/\d+\/)["'][^>]*>([\s\S]*?)<\/a>/gi,
  ])
}
