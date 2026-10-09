import type { CatalogItem } from '../types'
import { absoluteUrl, parseIsoDate, stripTags } from '../normalize'

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

const JSON_LD_RE =
  /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi

const LISTABLE_TYPES = new Set([
  'VideoObject',
  'Article',
  'NewsArticle',
  'BlogPosting',
  'SocialMediaPosting',
])

function isType(node: Record<string, JsonValue>, ...types: string[]): boolean {
  const raw = node['@type']
  const values = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  return values.some((entry) => typeof entry === 'string' && types.includes(entry))
}

function asRecord(value: JsonValue): Record<string, JsonValue> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : undefined
}

function asArray(value: JsonValue): JsonValue[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function text(value: JsonValue): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  const record = asRecord(value)
  if (record && '@value' in record) return text(record['@value'])
  return ''
}

function imageUrl(value: JsonValue, pageUrl: string): string | undefined {
  if (typeof value === 'string') return absoluteUrl(value, pageUrl)
  const record = asRecord(value)
  if (!record) return undefined
  return (
    absoluteUrl(text(record.url), pageUrl) ||
    absoluteUrl(text(record.contentUrl), pageUrl) ||
    absoluteUrl(text(record['@id']), pageUrl)
  )
}

function flattenNodes(root: JsonValue): Record<string, JsonValue>[] {
  const nodes: Record<string, JsonValue>[] = []
  const visit = (value: JsonValue) => {
    const record = asRecord(value)
    if (!record) return
    nodes.push(record)
    for (const entry of asArray(record['@graph'])) visit(entry)
  }

  if (Array.isArray(root)) {
    for (const entry of root) visit(entry)
  } else {
    visit(root)
  }
  return nodes
}

function mediaItemToCatalog(
  node: Record<string, JsonValue>,
  pageUrl: string,
  fallbackId: string,
): CatalogItem | undefined {
  const typeRaw = node['@type']
  const types = Array.isArray(typeRaw)
    ? typeRaw.filter((t): t is string => typeof t === 'string')
    : typeof typeRaw === 'string'
      ? [typeRaw]
      : []
  if (!types.some((t) => LISTABLE_TYPES.has(t))) return undefined

  const name = text(node.name) || text(node.headline)
  const originUrl =
    absoluteUrl(text(node.url), pageUrl) ||
    absoluteUrl(text(node['@id']), pageUrl) ||
    absoluteUrl(text(node.mainEntityOfPage), pageUrl)
  if (!name || !originUrl) return undefined

  const image =
    imageUrl(node.thumbnailUrl, pageUrl) ||
    imageUrl(node.thumbnail, pageUrl) ||
    imageUrl(node.image, pageUrl)
  const description = stripTags(text(node.description))
  const publishedAt =
    parseIsoDate(text(node.uploadDate)) ||
    parseIsoDate(text(node.datePublished)) ||
    parseIsoDate(text(node.dateCreated))

  return {
    id: fallbackId,
    title: name.slice(0, 200),
    originUrl,
    image,
    summary: (description || name).slice(0, 220),
    publishedAt,
    contentType: types.includes('VideoObject') ? 'video' : 'article',
  }
}

function listItemToCatalogItem(
  listItem: Record<string, JsonValue>,
  pageUrl: string,
  index: number,
): CatalogItem | undefined {
  const itemNode = asRecord(listItem.item) ?? listItem

  const fromMedia = itemNode ? mediaItemToCatalog(itemNode, pageUrl, `jsonld-item-${index}`) : undefined
  if (fromMedia) return fromMedia

  const originUrl =
    absoluteUrl(text(listItem.url), pageUrl) ||
    absoluteUrl(text(itemNode?.url), pageUrl) ||
    absoluteUrl(text(itemNode?.['@id']), pageUrl)
  const title =
    text(listItem.name) ||
    text(itemNode?.name) ||
    text(itemNode?.headline) ||
    ''
  if (!originUrl || !title) return undefined

  const image =
    imageUrl(listItem.image, pageUrl) ||
    (itemNode ? imageUrl(itemNode.image, pageUrl) || imageUrl(itemNode.thumbnailUrl, pageUrl) : undefined)

  return {
    id: `jsonld-item-${index}`,
    title: title.slice(0, 200),
    originUrl,
    image,
    summary: title.slice(0, 220),
    publishedAt:
      parseIsoDate(text(listItem.datePublished)) ||
      parseIsoDate(text(itemNode?.datePublished)) ||
      parseIsoDate(text(itemNode?.uploadDate)),
  }
}

function collectFromItemList(node: Record<string, JsonValue>, pageUrl: string, items: CatalogItem[]): void {
  let index = items.length
  for (const entry of asArray(node.itemListElement)) {
    const listItem = asRecord(entry)
    if (!listItem) continue
    const item = listItemToCatalogItem(listItem, pageUrl, index++)
    if (item) items.push(item)
  }
}

function dedupeItems(items: CatalogItem[]): CatalogItem[] {
  const seen = new Set<string>()
  const result: CatalogItem[] = []
  for (const item of items) {
    const key = item.originUrl
    if (seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }
  return result
}

/** Schema.org JSON-LD：ItemList / VideoObject / Article 等 */
export function extractJsonLdCatalog(html: string, pageUrl: string, listsOnly = false): CatalogItem[] {
  const items: CatalogItem[] = []

  for (const match of html.matchAll(JSON_LD_RE)) {
    const raw = match[1]?.trim()
    if (!raw) continue

    let parsed: JsonValue
    try {
      parsed = JSON.parse(raw) as JsonValue
    } catch {
      continue
    }

    for (const node of flattenNodes(parsed)) {
      if (isType(node, 'ItemList')) {
        collectFromItemList(node, pageUrl, items)
      }

      if (isType(node, 'CollectionPage', 'WebPage')) {
        const mainEntity = asRecord(node.mainEntity)
        if (mainEntity && isType(mainEntity, 'ItemList')) {
          collectFromItemList(mainEntity, pageUrl, items)
        }
      }

      if (!listsOnly && typesIncludeListable(node)) {
        const item = mediaItemToCatalog(node, pageUrl, `jsonld-${items.length}`)
        if (item) items.push(item)
      }

      const mainEntity = asRecord(node.mainEntity)
      if (!listsOnly && mainEntity && typesIncludeListable(mainEntity)) {
        const item = mediaItemToCatalog(mainEntity, pageUrl, `jsonld-main-${items.length}`)
        if (item) items.push(item)
      }
    }
  }

  return dedupeItems(items)
}

function typesIncludeListable(node: Record<string, JsonValue>): boolean {
  const raw = node['@type']
  const values = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  return values.some((entry) => typeof entry === 'string' && LISTABLE_TYPES.has(entry))
}
