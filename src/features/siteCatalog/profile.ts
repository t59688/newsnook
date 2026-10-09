import type { FrameworkHint } from '../frameworkDetect/types'
import type { CatalogLink, CatalogProfile, CatalogRequest } from './types'
import { siteUrl, searchCapabilityUrl, isSensitiveCatalogField } from './context'
import type { NewsSource } from '../../sources/registry'

const ENGINES = new Set(['generic', 'maccms', 'seacms', 'fyfcms', 'zanpian', 'nnyy', 'jeecms', 'wordpress', 'typecho', 'dedecms', 'empirecms', 'pbootcms', 'eyoucms', 'zblog', 'drupal', 'joomla', 'hugo', 'hexo', 'ghost'])
const record = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** Validate imported/synced configuration at the local boundary. Unknown revisions are re-discovered. */
export function normalizeCatalogProfile(value: unknown, sourceUrl: string): CatalogProfile | undefined {
  const input = record(value)
  if (!input || input.version !== 1 || input.rulesRevision !== 1) return undefined
  const root = siteUrl(String(input.siteRoot ?? ''), sourceUrl)
  if (!root) return undefined
  const cleanLinks = (value: unknown): CatalogLink[] => {
    const result = new Map<string, CatalogLink>()
    for (const entry of Array.isArray(value) ? value.slice(0, 100) : []) {
      const item = record(entry)
      if (!item || typeof item.title !== 'string' || typeof item.url !== 'string') continue
      const url = siteUrl(item.url, sourceUrl)
      const title = item.title.trim().slice(0, 100)
      if (url && title) result.set(url, { title, url })
    }
    return [...result.values()]
  }
  let search: CatalogRequest | undefined
  const request = record(input.search)
  if (request && typeof request.url === 'string' && (request.method === 'GET' || request.method === 'POST')) {
    const url = searchCapabilityUrl(request.url, sourceUrl)?.replace(/%7Bquery%7D/gi, '{query}')
    const form: Record<string, string> = {}
    for (const [key, field] of Object.entries(record(request.form) ?? {}).slice(0, 20)) {
      if (typeof field === 'string' && key.length <= 100 && !isSensitiveCatalogField(key)) form[key] = field.slice(0, 500)
    }
    const fields = (Array.isArray(request.fields) ? request.fields.slice(0, 21) : []).flatMap((field) => {
      const item = record(field)
      return item && typeof item.name === 'string' && typeof item.value === 'string' && item.name.length <= 100 && !isSensitiveCatalogField(item.name) ? [{ name: item.name, value: item.value.slice(0, 500) }] : []
    })
    if (url && (fields.some((field) => field.value === '{query}') || url.includes('{query}') || Object.values(form).includes('{query}'))) search = { url, method: request.method, ...(fields.length ? { fields } : Object.keys(form).length ? { form } : {}) }
  }
  const filters = (Array.isArray(input.filters) ? input.filters.slice(0, 10) : []).flatMap((entry) => {
    const item = record(entry)
    const options = cleanLinks(item?.options)
    return item && typeof item.title === 'string' && options.length ? [{ title: item.title.slice(0, 30), options }] : []
  })
  return { version: 1, rulesRevision: 1, siteRoot: root, engine: ENGINES.has(String(input.engine)) ? input.engine as CatalogProfile['engine'] : 'generic', categories: cleanLinks(input.categories), search, sorts: cleanLinks(input.sorts), filters }
}

export function catalogProfileFor(source: NewsSource): CatalogProfile {
  let siteRoot = source.url
  try { siteRoot = new URL('/', source.url).href } catch { /* Imported invalid URLs degrade until normalization or request validation. */ }
  return normalizeCatalogProfile(source.catalogProfile, source.url) ?? {
    version: 1, rulesRevision: 1, siteRoot,
    engine: source.frameworkHint?.framework ?? 'generic',
    categories: source.frameworkHint?.categories?.filter((item) => siteUrl(item.url, source.url)) ?? [],
  }
}

/** Retain bounded, legal future-version data for backup/sync, without using it at runtime. */
export function preserveFutureCatalogProfile(value: unknown, sourceUrl: string): Record<string, unknown> | undefined {
  const input = record(value)
  if (!input || !Number.isSafeInteger(input.version) || typeof input.version !== 'number' || input.version < 1 || (input.version === 1 && input.rulesRevision === 1)) return undefined
  if (typeof input.siteRoot !== 'string' || !siteUrl(input.siteRoot, sourceUrl)) return undefined
  try {
    const json = JSON.stringify(input)
    if (json.length > 32768) return undefined
    const check = (value: unknown, depth: number): boolean => {
      if (depth > 8) return false
      if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return true
      if (Array.isArray(value)) return value.length <= 100 && value.every((entry) => check(entry, depth + 1))
      const item = record(value)
      return !!item && Object.entries(item).every(([key, entry]) => !isSensitiveCatalogField(key) && check(entry, depth + 1))
    }
    return check(input, 0) ? JSON.parse(json) : undefined
  } catch { return undefined }
}

export function normalizeFrameworkHint(value: unknown, sourceUrl: string): FrameworkHint | undefined {
  const input = record(value)
  if (!input || !ENGINES.has(String(input.framework))) return undefined
  const pattern = record(input.paginationPattern)
  let paginationPattern: FrameworkHint['paginationPattern'] = { kind: 'next-link' }
  if (pattern?.kind === 'query-param' && typeof pattern.param === 'string' && /^[a-z0-9_]{1,50}$/i.test(pattern.param)) paginationPattern = { kind: 'query-param', param: pattern.param }
  if (pattern?.kind === 'path-segment' && typeof pattern.template === 'string') {
    const template = siteUrl(pattern.template, sourceUrl)?.replace(/%7Bpage%7D/gi, '{page}')
    if (template?.includes('{page}')) paginationPattern = { kind: 'path-segment', template }
  }
  const categories = normalizeCatalogProfile({ version: 1, rulesRevision: 1, siteRoot: sourceUrl, engine: input.framework, categories: input.categories }, sourceUrl)?.categories
  const searchTemplate = typeof input.searchTemplate === 'string' ? searchCapabilityUrl(input.searchTemplate, sourceUrl)?.replace(/%7Bquery%7D/gi, '{query}') : undefined
  const sortOptions = (Array.isArray(input.sortOptions) ? input.sortOptions.slice(0, 10) : []).flatMap((entry) => {
    const option = record(entry)
    return option && typeof option.label === 'string' && ['default', 'time', 'hits', 'hits_day', 'hits_week', 'hits_month', 'score'].includes(String(option.key)) ? [{ key: option.key as NonNullable<FrameworkHint['sortOptions']>[number]['key'], label: option.label.slice(0, 30) }] : []
  })
  return { framework: input.framework as FrameworkHint['framework'], paginationPattern, categories, searchTemplate, sortOptions, themeVariant: typeof input.themeVariant === 'string' ? input.themeVariant.slice(0, 50) : undefined }
}
