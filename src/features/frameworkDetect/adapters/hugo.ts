import type { FrameworkHint } from '../types'

export function detectHugo(html: string, pageUrl: string): FrameworkHint | null {
  if (!/<meta[^>]+name=["']generator["'][^>]+content=["']Hugo/i.test(html)) return null

  const base = new URL(pageUrl)
  const trailingSlash = base.pathname.endsWith('/') ? '' : '/'
  const template = `${base.origin}${base.pathname}${trailingSlash}page/{page}/`

  const categories = extractHugoNavLinks(html, pageUrl)

  return {
    framework: 'hugo',
    paginationPattern: { kind: 'path-segment', template },
    categories: categories.length > 0 ? categories : undefined,
  }
}

function extractHugoNavLinks(
  html: string,
  pageUrl: string,
): { title: string; url: string }[] {
  const results: { title: string; url: string }[] = []
  const patterns = [/\/categories\//i, /\/tags\//i, /\/section\//i]

  for (const match of html.matchAll(
    /<a\b[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
  )) {
    const href = match[1] ?? ''
    const label = match[2]?.replace(/<[^>]+>/g, '').trim() ?? ''
    if (!label || !href) continue
    if (!patterns.some((p) => p.test(href))) continue
    try {
      const url = new URL(href, pageUrl).href
      results.push({ title: label, url })
    } catch {
      continue
    }
  }

  return results
}
