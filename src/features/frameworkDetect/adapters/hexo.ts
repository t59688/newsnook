import type { FrameworkHint } from '../types'

export function detectHexo(html: string, pageUrl: string): FrameworkHint | null {
  if (!/<meta[^>]+name=["']generator["'][^>]+content=["']Hexo/i.test(html)) return null

  const base = new URL(pageUrl)
  const trailingSlash = base.pathname.endsWith('/') ? '' : '/'
  const template = `${base.origin}${base.pathname}${trailingSlash}page/{page}/`

  const categories: { title: string; url: string }[] = []
  for (const match of html.matchAll(
    /<a\b[^>]+href=["']([^"']*\/categories\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const href = match[1] ?? ''
    const label = match[2]?.replace(/<[^>]+>/g, '').trim() ?? ''
    if (!label || !href) continue
    try {
      categories.push({ title: label, url: new URL(href, pageUrl).href })
    } catch {
      continue
    }
  }

  return {
    framework: 'hexo',
    paginationPattern: { kind: 'path-segment', template },
    categories: categories.length > 0 ? categories : undefined,
  }
}
