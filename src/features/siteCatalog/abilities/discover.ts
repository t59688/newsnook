import type { FrameworkId } from '../../frameworkDetect/types'
import type { CatalogRequest } from '../types'
import { searchCapabilityUrl } from '../context'
import { discoverFormCapabilities } from './forms'
import { discoverLinkControls } from './linkControls'
import type { CatalogCapabilities } from './types'
import { MAX_CONTROLS } from './types'

function structuredSearch(document: Document, baseUrl: string): CatalogRequest | undefined {
  for (const script of [...document.querySelectorAll('script[type="application/ld+json"]')].slice(0, 12)) {
    const body = script.textContent || ''
    if (body.length > 262144) continue
    try {
      const visit = (value: unknown, depth = 0): CatalogRequest | undefined => {
        if (!value || typeof value !== 'object' || depth > 6) return undefined
        if (Array.isArray(value)) {
          for (const child of value.slice(0, 100)) { const result = visit(child, depth + 1); if (result) return result }
          return undefined
        }
        const record = value as Record<string, unknown>
        if (record['@type'] === 'SearchAction') {
          const target = typeof record.target === 'string' ? record.target : record.target && typeof record.target === 'object' ? (record.target as Record<string, unknown>).urlTemplate : undefined
          const query = typeof record['query-input'] === 'string' ? record['query-input'].match(/(?:^|\s)name=([A-Za-z_][\w-]*)/)?.[1] : undefined
          if (typeof target === 'string' && query && target.includes(`{${query}}`)) {
            const url = searchCapabilityUrl(target.replaceAll(`{${query}}`, '{query}'), baseUrl)
            if (url && !/\{(?!query\})/.test(target.replaceAll(`{${query}}`, '{query}'))) return { url: url.replace(/%7Bquery%7D/gi, '{query}'), method: 'GET' }
          }
        }
        for (const key of ['@graph', 'potentialAction']) { const result = visit(record[key], depth + 1); if (result) return result }
        return undefined
      }
      const result = visit(JSON.parse(body))
      if (result) return result
    } catch { /* Invalid structured data cannot disable form/link discovery. */ }
  }
  return undefined
}

/** Shared deterministic discovery for static HTML and a rendered DOM snapshot. */
export function discoverPageCapabilities(document: Document, baseUrl: string, engine: FrameworkId, request: CatalogRequest, source: CatalogCapabilities['source'] = 'html'): CatalogCapabilities {
  const forms = discoverFormCapabilities(document, baseUrl, engine, request)
  const links = discoverLinkControls(document, baseUrl, request.url, engine)
  const search = forms.search ?? structuredSearch(document, baseUrl)
  const signatures = new Set<string>()
  const controls = [...forms.controls, ...links.controls].filter(control => {
    const signature = control.semantic + ':' + control.choices.map(choice => JSON.stringify(choice.request)).join('|')
    if (signatures.has(signature)) return false
    signatures.add(signature)
    return true
  }).slice(0, MAX_CONTROLS)
  return {
    version: 1, source, engine, controls, search,
    searchEvidence: forms.searchEvidence ?? (search ? { confidence: 'direct', signals: ['schema-search-action', 'declared-url-template'] } : undefined),
    nextRequest: forms.nextRequest,
    issues: [...forms.issues, ...links.issues].slice(0, 24),
  }
}
