import { catalogBaseUrl, catalogDocument } from '../catalogEngine/extractors/domCards'
import { absoluteUrl } from '../catalogEngine/normalize'

export const MAX_CATALOG_BYTES = 2 * 1024 * 1024
export function pageContext(html: string, pageUrl: string) {
  if (new TextEncoder().encode(html).byteLength > MAX_CATALOG_BYTES) throw new Error('站点响应过大，暂时无法解析')
  const document = catalogDocument(html)
  return { html, pageUrl, document, baseUrl: catalogBaseUrl(document, pageUrl) }
}
export function siteUrl(raw: string, baseUrl: string): string | undefined {
  const result = absoluteUrl(raw, baseUrl)
  if (!result || new URL(result).origin !== new URL(baseUrl).origin) return undefined
  const parsed = new URL(result)
  if (parsed.username || parsed.password) return undefined
  parsed.hash = ''
  return parsed.href
}
/** Search plans are persisted; dynamic credentials must stay outside that contract. */
export function isSensitiveCatalogField(name: string): boolean {
  return /password|token|csrf|secret|nonce|session|sessid|__proto__|constructor|prototype|^(?:api[_-]?key|auth|authorization|signature|sid)$/i.test(name)
}
export function searchCapabilityUrl(raw: string, baseUrl: string): string | undefined {
  const url = siteUrl(raw, baseUrl)
  if (!url || [...new URL(url).searchParams.keys()].some(isSensitiveCatalogField)) return undefined
  return url
}
export function isDisabled(node: Element): boolean {
  return node.hasAttribute('disabled') || node.getAttribute('aria-disabled') === 'true' || /(?:^|\s)(?:disabled|disable)(?:\s|$)/i.test(node.className || '') || Boolean(node.closest('[aria-disabled="true"], .disabled'))
}
