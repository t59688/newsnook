import type { FrameworkHint } from '../types'

export function detectGhost(html: string, pageUrl: string): FrameworkHint | null {
  if (!/<meta[^>]+name=["']generator["'][^>]+content=["']Ghost/i.test(html)) return null

  const base = new URL(pageUrl)
  const trailingSlash = base.pathname.endsWith('/') ? '' : '/'
  const template = `${base.origin}${base.pathname}${trailingSlash}page/{page}/`

  return {
    framework: 'ghost',
    paginationPattern: { kind: 'path-segment', template },
  }
}
