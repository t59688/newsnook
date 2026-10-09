import { cleanSummaryText } from '../../lib/cleanSummary'
import { normalizeCatalogTitle, stripTags } from './normalize'

function titleFromNnyyTag(pageHtml: string): string | undefined {
  const book = pageHtml.match(/<title>\s*《([^》]+)》/i)?.[1]
  if (book) return normalizeCatalogTitle(book)
  const tag = pageHtml.match(/<title>([^<]+)/i)?.[1]
  if (!tag) return undefined
  const head = tag.split(/全集在线观看|线上看|_/)[0]?.trim() ?? ''
  const cleaned = head.replace(/^《|》$/g, '').trim()
  return cleaned ? normalizeCatalogTitle(cleaned) : undefined
}

function synopsisFromProductExcerpt(pageHtml: string, title?: string): string | undefined {
  const raw =
    pageHtml.match(/剧情简介：\s*<span>([\s\S]*?)<\/span>/i)?.[1] ||
    pageHtml.match(
      /class="[^"]*product-excerpt[^"]*"[^>]*>[\s\S]*?剧情简介：\s*<span>([\s\S]*?)<\/span>/i,
    )?.[1]
  if (!raw) return undefined
  let synopsis: string | undefined = cleanSummaryText(stripTags(raw), title)
  if (synopsis && /努努影院|免费高清|支持手机观看/i.test(synopsis)) {
    synopsis = undefined
  }
  if (synopsis) synopsis = normalizeCatalogTitle(synopsis)
  if (synopsis && title && synopsis === title) synopsis = undefined
  if (synopsis && synopsis.length > 280) synopsis = `${synopsis.slice(0, 277)}…`
  return synopsis && synopsis.length >= 12 ? synopsis : undefined
}

export function extractWebCatalogDetailMeta(pageHtml: string): {
  title?: string
  synopsis?: string
} {
  const h1Raw = pageHtml.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
  let title = h1Raw
    ? normalizeCatalogTitle(
        stripTags(h1Raw)
          .replace(/\s*-\s*全\d+集.*$/i, '')
          .replace(/\s*\(\d{4}\)\s*$/, '')
          .trim(),
      )
    : undefined

  const fromTag = titleFromNnyyTag(pageHtml)
  if (fromTag) title = fromTag

  if (!title || title.length < 2) {
    title = fromTag
  }

  const blurbMatch = pageHtml.match(
    /class="[^"]*(?:slide-info-desc|vod_content|detail-content|desc|sketch)[^"]*"[^>]*>([\s\S]*?)<\//i,
  )?.[1]

  let synopsis: string | undefined = synopsisFromProductExcerpt(pageHtml, title)
  if (!synopsis && blurbMatch) {
    synopsis = cleanSummaryText(stripTags(blurbMatch), title)
    if (synopsis && /线上看|免费高清|华人OK影院|努努影院|支持手机观看/i.test(synopsis)) {
      synopsis = undefined
    }
    if (synopsis) synopsis = normalizeCatalogTitle(synopsis)
    if (synopsis && title && synopsis === title) synopsis = undefined
    if (synopsis && synopsis.length > 280) synopsis = `${synopsis.slice(0, 277)}…`
  }

  return {
    title: title && title.length >= 2 ? title : undefined,
    synopsis: synopsis && synopsis.length >= 12 ? synopsis : undefined,
  }
}
