/** 从努努影院详情页脚本解析 /_gp/{id}/{ep} 播放 API。 */
export function nnyyPlayApiUrls(html: string, pageUrl: string): string[] {
  const id = html.match(/replace\('\{0\}',\s*'(\d+)'\)/)?.[1]
  if (!id) return []

  const eps = [
    ...html.matchAll(/\bon_ep\('([^']+)'\)/g),
    ...html.matchAll(/\bep_slug=["']([^"']+)["']/g),
  ]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))

  const slug = eps[0] || 'hd'

  try {
    const origin = new URL(pageUrl).origin
    return [`${origin}/_gp/${id}/${slug}`]
  } catch {
    return []
  }
}
