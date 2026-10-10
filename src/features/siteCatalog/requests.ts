import type { CatalogProfile, CatalogRequest } from './types'

export function catalogSearchRequest(profile: CatalogProfile, query: string): CatalogRequest | undefined {
  if (!profile.search || !query.trim()) return undefined
  const raw = profile.search
  const url = raw.url.replaceAll('{query}', encodeURIComponent(query.trim()))
  const form = raw.form && Object.fromEntries(Object.entries(raw.form).map(([key, value]) => [key, value.replaceAll('{query}', query.trim())]))
  const fields = raw.fields?.map((field) => ({ ...field, value: field.value.replaceAll('{query}', query.trim()) }))
  if (raw.method === 'POST') return fields ? { url, method: 'POST', fields } : { url, method: 'POST', form }
  const parsed = new URL(url)
  const entries = fields ?? Object.entries(form ?? {}).map(([name, value]) => ({ name, value }))
  for (const key of new Set(entries.map((field) => field.name))) parsed.searchParams.delete(key)
  for (const { name, value } of entries) parsed.searchParams.append(name, value)
  return { url: parsed.href, method: 'GET' }
}
