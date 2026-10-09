import type { FrameworkHint } from '../types'
import { extractCategoryLinks } from './shared'

/**
 * JEECMS — Java 系内容管理系统。
 *
 * 探测信号：页面含 `Powered by JEECMS` 或路径含 `/jeecms/`。
 *
 * 默认 URL 规则：
 *   分类列表  /channel/ID.jhtml 或 /channel/ID_PAGE.jhtml
 *   搜索      /search.jspx?q={query}
 *   翻页      query-param ?page=N
 */
export function detectJeecms(html: string, pageUrl: string): FrameworkHint | null {
  const hasSignal =
    /Powered\s+by\s+JEECMS/i.test(html) ||
    /\/jeecms\//i.test(html) && /\.jhtml|\.jspx/i.test(html)

  if (!hasSignal) return null

  const base = new URL(pageUrl)
  const themeVariant = detectJeecmsThemeVariant(html)
  const categories = extractJeecmsCategories(html, pageUrl)

  return {
    framework: 'jeecms',
    themeVariant,
    paginationPattern: { kind: 'query-param', param: 'page' },
    categories: categories.length > 0 ? categories : undefined,
    searchTemplate: `${base.origin}/search.jspx?q={query}`,
  }
}

function detectJeecmsThemeVariant(html: string): string | undefined {
  if (/\/r\/cms\//i.test(html)) return 'cms-static'
  if (/\/jeecms\//i.test(html)) return 'jeecms-default'
  return undefined
}

function extractJeecmsCategories(
  html: string,
  pageUrl: string,
): { title: string; url: string }[] {
  // JEECMS 分类链接：/channel/ID.jhtml 或 /栏目别名/
  return extractCategoryLinks(html, pageUrl, [
    /<a\b[^>]+href=["']([^"']*\/channel\/\d+\.jhtml)["'][^>]*>([\s\S]*?)<\/a>/gi,
    /<a\b[^>]+href=["']([^"']*\/channel\/[^/"']+\/index\.jhtml)["'][^>]*>([\s\S]*?)<\/a>/gi,
  ])
}
