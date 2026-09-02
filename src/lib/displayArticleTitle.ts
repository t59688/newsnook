function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function sourceNameVariants(...names: Array<string | undefined>): string[] {
  const set = new Set<string>()
  for (const name of names) {
    const trimmed = name?.trim()
    if (!trimmed) continue
    set.add(trimmed)
    const compact = trimmed.replace(/\s+/g, '')
    if (compact) set.add(compact)
  }
  return [...set]
}

/** 分享图 / 速读等场景：去掉标题末尾的来源后缀（如「-36氪」） */
export function displayArticleTitle(
  title: string,
  options?: { sourceName?: string; sourceLabel?: string },
): string {
  let value = title.trim()
  if (!value) return '一篇文章'

  const sources = sourceNameVariants(options?.sourceName, options?.sourceLabel)
  for (const source of sources) {
    for (const suffix of [
      ` - ${source}`,
      `-${source}`,
      ` | ${source}`,
      `｜${source}`,
      ` – ${source}`,
      `—${source}`,
      ` — ${source}`,
    ]) {
      if (value.endsWith(suffix)) {
        value = value.slice(0, -suffix.length).trim()
        break
      }
    }

    const flexible = escapeRegExp(source).replace(/\s+/g, '\\s*')
    value = value.replace(new RegExp(`[-–—|｜]\\s*${flexible}$`), '').trim()
  }

  return value || '一篇文章'
}
