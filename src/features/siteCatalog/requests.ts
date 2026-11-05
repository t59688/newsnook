import type { CatalogRequest } from './types'

export function catalogSearchRequest(profile: { search?: CatalogRequest }, query: string): CatalogRequest | undefined {
  if (!profile.search || !query.trim()) return undefined
  const raw = profile.search
  const encodedQuery = encodeURIComponent(query.trim())
  const plainQuery = query.trim()
  const replaceQuery = (value: string, replacement: string) => value.split('{query}').join(replacement)
  const url = replaceQuery(raw.url, encodedQuery)
  let form: Record<string, string> | undefined
  if (raw.form) {
    form = {}
    for (const [key, value] of Object.entries(raw.form)) form[key] = replaceQuery(value, plainQuery)
  }
  const fields = raw.fields?.map((field) => ({ ...field, value: replaceQuery(field.value, plainQuery) }))
  if (raw.method === 'POST') return fields ? { url, method: 'POST', fields } : { url, method: 'POST', form }
  const parsed = new URL(url)
  const entries = fields ?? Object.entries(form ?? {}).map(([name, value]) => ({ name, value }))
  for (const key of new Set(entries.map((field) => field.name))) parsed.searchParams.delete(key)
  for (const { name, value } of entries) parsed.searchParams.append(name, value)
  return { url: parsed.href, method: 'GET' }
}
