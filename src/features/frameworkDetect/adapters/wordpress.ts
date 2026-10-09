import type { FrameworkHint } from '../types'

export function detectWordpress(html: string, pageUrl: string): FrameworkHint | null {
  const isWp =
    /<meta[^>]+name=["']generator["'][^>]+content=["']WordPress/i.test(html) ||
    /\/wp-content\//i.test(html)
  if (!isWp) return null

  const base = new URL(pageUrl)
  const trailingSlash = base.pathname.endsWith('/') ? '' : '/'
  const template = `${base.origin}${base.pathname}${trailingSlash}page/{page}/`

  return {
    framework: 'wordpress',
    paginationPattern: { kind: 'path-segment', template },
    searchTemplate: `${base.origin}/?s={query}`,
  }
}
