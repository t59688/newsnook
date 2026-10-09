import type { FrameworkHint } from '../types'

export type FrameworkCategory = NonNullable<FrameworkHint['categories']>[number]

export function extractCategoryLinks(
  html: string,
  pageUrl: string,
  patterns: RegExp[],
): FrameworkCategory[] {
  const results: FrameworkCategory[] = []
  const seen = new Set<string>()

  for (const pattern of patterns) {
    for (const match of html.matchAll(pattern)) {
      const rawHref = match[1]
      const rawTitle = stripHtml(match[2] ?? '')
      if (!rawTitle || !rawHref) continue
      try {
        const url = new URL(rawHref, pageUrl).href
        if (seen.has(url)) continue
        seen.add(url)
        results.push({ title: rawTitle, url })
      } catch {
        continue
      }
    }
  }

  return results
}

function stripHtml(input: string): string {
  return input.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
