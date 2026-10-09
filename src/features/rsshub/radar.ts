/**
 * RSSHub Radar discovery. The remote catalog contains declarations, never executable code.
 * Loaded only for website-URL searches; ordinary feed refresh never downloads the catalog.
 */
import { fetchAbsoluteText } from '../../lib/http'
import { rssHubFeedUrl, validateRssHubRoutePath, type RssHubInstance } from './instances'

export const RSSHUB_RADAR_URL =
  'https://raw.githubusercontent.com/DIYgod/RSSHub/refs/heads/gh-pages/build/radar-rules.json'
/** Public RSSHub instance is a fallback metadata publisher, never a code-execution source. */
export const RSSHUB_RADAR_FALLBACK_URL = 'https://rsshub.isrss.com/api/radar/rules'

const MAX_CATALOG_BYTES = 2_200_000
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const MAX_MATCHES = 20

export interface RssHubRadarCandidate {
  providerId: 'rsshub'
  entryId: string
  type: 'rsshub'
  title: string
  description?: string
  categories: string[]
  siteUrl: string
  feedUrl?: string
  statusNote: string
  routeTemplate: string
  routePath?: string
  parameters: Record<string, string>
  missingParameters: string[]
  instanceId?: string
}

type RadarRule = { title?: unknown; source?: unknown; target?: unknown; docs?: unknown }
type RadarDomain = Record<string, unknown>
type RadarCatalog = Record<string, RadarDomain>

let cached: { data: RadarCatalog; at: number } | null = null

export async function loadRssHubRadarCatalog(
  signal?: AbortSignal,
  fetcher: typeof fetchAbsoluteText = fetchAbsoluteText,
): Promise<RadarCatalog> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.data
  for (const endpoint of [RSSHUB_RADAR_URL, RSSHUB_RADAR_FALLBACK_URL]) {
    const controller = new AbortController()
    const forwardAbort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', forwardAbort, { once: true })
    if (signal?.aborted) forwardAbort()
    const timeout = globalThis.setTimeout(() => controller.abort(), 12_000)
    try {
      const text = await fetcher(endpoint, { signal: controller.signal, accept: 'application/json' })
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
      if (new TextEncoder().encode(text).length > MAX_CATALOG_BYTES) throw new Error('RSSHub Radar 元数据体积异常')
      const parsed: unknown = JSON.parse(text)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length < 100) {
        throw new Error('RSSHub Radar 数据格式不正确')
      }
      cached = { data: parsed as RadarCatalog, at: Date.now() }
      return cached.data
    } catch (error) {
      if (signal?.aborted) throw error
      // Try the mirror; a previously validated memory cache remains usable.
    } finally {
      globalThis.clearTimeout(timeout)
      signal?.removeEventListener('abort', forwardAbort)
    }
  }
  if (cached) return cached.data
  throw new Error('RSSHub 路由目录暂时无法访问，请稍后重试或粘贴完整 RSSHub 地址')
}

export function clearRssHubRadarCacheForTest(): void { cached = null }

function substituteTarget(
  target: string,
  parameters: Record<string, string>,
): { path?: string; missing: string[] } {
  // Official Radar assets can contain legacy JS function strings. Never evaluate them.
  if (!target.startsWith('/') || /(?:=>|\$\{|[<>`"'{}\\\r\n])/.test(target)) return { missing: [] }
  const missing = new Set<string>()
  let replaced = target.replace(/\/:([a-zA-Z_][\w]*)(\?(?![a-zA-Z_][\w-]*=))?/g, (whole, key: string, optional: string) => {
    const value = parameters[key]
    if (!value) {
      if (optional) return ''
      missing.add(key)
      return whole
    }
    return '/' + encodeURIComponent(value)
  })
  // Named query parameters use :key syntax without the preceding slash.
  replaced = replaced.replace(/([?&][a-zA-Z_][\w-]*=):([a-zA-Z_][\w]*)/g, (_all, prefix: string, key: string) => {
    if (!parameters[key]) { missing.add(key); return prefix + ':' + key }
    return prefix + encodeURIComponent(parameters[key])
  })
  try {
    if (!missing.size) validateRssHubRoutePath(replaced)
    else validateRssHubRoutePath(target)
  } catch { return { missing: [] } }
  return { path: missing.size ? undefined : replaced, missing: [...missing] }
}

export function resolveRssHubRadarTarget(
  target: string,
  values: Record<string, string>,
): { path?: string; missing: string[] } {
  const safeValues: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    if (!/^[a-zA-Z_][\w]*$/.test(key) || ['__proto__', 'prototype', 'constructor'].includes(key) || value.length > 250) continue
    if (value) safeValues[key] = value
  }
  return substituteTarget(target, safeValues)
}

function matchSource(
  pattern: string,
  url: URL,
): Record<string, string> | null {
  if (!pattern.startsWith('/') || pattern.startsWith('//') || /(?:=>|\$\{|[<>`"'{}\\\r\n])/.test(pattern)) return null
  const qIndex = pattern.search(/\?[a-zA-Z_][\w-]*=/)
  const pathPattern = qIndex >= 0 ? pattern.slice(0, qIndex) : pattern
  const queryPattern = qIndex >= 0 ? pattern.slice(qIndex + 1) : ''
  const sourceParts = pathPattern.split('/').filter(Boolean)
  let actualParts: string[]
  try {
    actualParts = url.pathname.split('/').filter(Boolean).map((part) => decodeURIComponent(part))
  } catch { return null }
  if (sourceParts.length > 16 || actualParts.length > 16) return null
  const required = sourceParts.filter((part) => !/^:[a-zA-Z_][\w]*\?$/.test(part)).length
  if (actualParts.length < required || actualParts.length > sourceParts.length) return null
  const params: Record<string, string> = {}
  for (let i = 0; i < sourceParts.length; i++) {
    const part = sourceParts[i]
    const actual = actualParts[i]
    const dynamic = /^:([a-zA-Z_][\w]*)(\?)?$/.exec(part)
    if (dynamic) {
      if (!actual && !dynamic[2]) return null
      if (['__proto__', 'constructor', 'prototype'].includes(dynamic[1])) return null
      if (actual) params[dynamic[1]] = actual
    } else if (!actual || part !== actual) {
      return null
    }
  }
  if (queryPattern) {
    for (const item of queryPattern.split('&')) {
      const sep = item.indexOf('=')
      if (sep < 1) return null
      const name = item.slice(0, sep)
      const wanted = item.slice(sep + 1)
      const actual = url.searchParams.get(name)
      if (actual == null) return null
      const dynamic = /^:([a-zA-Z_][\w]*)$/.exec(wanted)
      if (dynamic) {
        if (['__proto__', 'constructor', 'prototype'].includes(dynamic[1])) return null
        params[dynamic[1]] = actual
      }
      else if (actual !== wanted) return null
    }
  }
  return params
}

/** Match a website URL to the official Radar domain/subdomain and parameter declarations. */
export function matchRssHubRadar(
  siteUrl: string,
  data: RadarCatalog,
  instances: readonly RssHubInstance[],
): RssHubRadarCandidate[] {
  const url = new URL(siteUrl)
  const host = url.hostname.toLowerCase()
  let domainName = ''
  for (const key of Object.keys(data)) {
    if ((host === key || host.endsWith('.' + key)) && key.length > domainName.length) domainName = key
  }
  if (!domainName) return []
  const domain = data[domainName]
  if (!domain || typeof domain !== 'object') return []
  const subdomain = host === domainName ? '.' : host.slice(0, -(domainName.length + 1))
  const entries = domain[subdomain]
  if (!Array.isArray(entries)) return []
  const selectedInstance = instances.find((item) => item.enabled)
  const seen = new Set<string>()
  const results: RssHubRadarCandidate[] = []
  for (const unknownRule of entries) {
    if (!unknownRule || typeof unknownRule !== 'object') continue
    const rule = unknownRule as RadarRule
    if (typeof rule.target !== 'string' || !Array.isArray(rule.source)) continue
    for (const source of rule.source) {
      if (typeof source !== 'string') continue
      const matched = matchSource(source, url)
      if (!matched) continue
      const resolved = substituteTarget(rule.target, matched)
      // Reject unsafe / unsupported JS target expressions, not just unmatched routes.
      if (!resolved.path && !resolved.missing.length) continue
      const signature = rule.target + '|' + source
      if (seen.has(signature)) continue
      seen.add(signature)
      const safePath = resolved.path
      let feedUrl: string | undefined
      try { if (safePath && selectedInstance) feedUrl = rssHubFeedUrl(selectedInstance, safePath) } catch { continue }
      const name = typeof rule.title === 'string' && rule.title.trim()
        ? rule.title.trim().slice(0, 100)
        : (typeof domain._name === 'string' ? domain._name : host).slice(0, 100)
      results.push({
        providerId: 'rsshub',
        entryId: 'rsshub:' + signature + '|' + url.origin,
        type: 'rsshub', title: name,
        description: typeof rule.docs === 'string' ? 'RSSHub 社区维护的转换路由' : undefined,
        categories: [], siteUrl: url.toString(),
        feedUrl, routeTemplate: rule.target, routePath: safePath,
        parameters: matched, missingParameters: resolved.missing,
        instanceId: selectedInstance?.id,
        statusNote: resolved.missing.length ? '路由需要补充参数，尚未检测可用性' : '仅命中规则，订阅前需要实际检测',
      })
      if (results.length >= MAX_MATCHES) return results
    }
  }
  return results
}

export async function discoverRssHubRadar(
  siteUrl: string,
  instances: readonly RssHubInstance[],
  signal?: AbortSignal,
): Promise<RssHubRadarCandidate[]> {
  const rules = await loadRssHubRadarCatalog(signal)
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  return matchRssHubRadar(siteUrl, rules, instances)
}
