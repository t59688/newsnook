import { extractHeuristicCardCatalog } from './extractors/heuristicCards'
import { extractJsonLdCatalog } from './extractors/jsonLd'
import { catalogBaseUrl, catalogDocument, extractDomCards } from './extractors/domCards'
import type { CatalogExtractOptions, CatalogExtractionResult, CatalogItem } from './types'

/** Structured lists, semantic containers, then the legacy repeated-link fallback. */
export function extractCatalog(html: string, pageUrl: string, options: CatalogExtractOptions = {}): CatalogExtractionResult {
  const minItems = options.minItems ?? 3
  const maxItems = Math.max(1, Math.min(1000, options.maxItems ?? 200))
  const document = options.document ?? catalogDocument(html)
  const baseUrl = catalogBaseUrl(document, pageUrl)
  const json = extractJsonLdCatalog(html, baseUrl)
  const listed = extractJsonLdCatalog(html, baseUrl, true)
  const dom = extractDomCards(html, pageUrl, document)
  const heuristic = extractHeuristicCardCatalog(html, baseUrl)
  let items: CatalogItem[]
  let extractor: CatalogExtractionResult['extractor']
  if (listed.length) { items = listed; extractor = 'json-ld' }
  else if (json.length >= Math.max(minItems, 2) && json.length >= dom.length) { items = json; extractor = 'json-ld' }
  else if (dom.length) { items = dom; extractor = 'dom-cards' }
  else if (heuristic.length) { items = heuristic; extractor = 'heuristic-cards' }
  else { items = json; extractor = json.length ? 'json-ld' : null }
  const metadata = new Map<string, Partial<CatalogItem>>()
  for (const item of [...heuristic, ...dom, ...json]) {
    const defined = Object.fromEntries(Object.entries(item).filter(([, value]) => value != null))
    metadata.set(item.originUrl, { ...metadata.get(item.originUrl), ...defined })
  }
  items = items.map((item) => ({ ...item, ...metadata.get(item.originUrl) }))
  return { items: items.slice(0, maxItems), extractor, confidence: extractor === 'json-ld' && items.length >= minItems ? 'high' : items.length >= minItems ? 'medium' : 'low', truncated: items.length > maxItems }
}
