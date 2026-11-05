import type { CatalogRequest } from '../types'

export type CatalogField = { name: string; value: string }
/** Preserve repeat-name entries and their order. Only observed successful controls are passed here. */
export function materializeCatalogRequest(url: string, method: 'GET' | 'POST', fields: readonly CatalogField[]): CatalogRequest {
  if (method === 'POST') return { url, method, fields: fields.map(field => ({ ...field })) }
  if (!fields.length) return { url, method }
  const parsed = new URL(url)
  for (const key of new Set(fields.map(field => field.name))) parsed.searchParams.delete(key)
  for (const { name, value } of fields) parsed.searchParams.append(name, value)
  return { url: parsed.href, method }
}

export function replaceFields(fields: readonly CatalogField[], name: string, values: readonly string[]): CatalogField[] {
  const result: CatalogField[] = []
  let inserted = false
  for (const field of fields) {
    if (field.name !== name) result.push({ ...field })
    else if (!inserted) {
      result.push(...values.map(value => ({ name, value })))
      inserted = true
    }
  }
  if (!inserted) result.push(...values.map(value => ({ name, value })))
  return result
}

/** A request identity includes method and payload; same URL does not imply same POST page. */
export function catalogRequestKey(request: CatalogRequest): string {
  const parsed = new URL(request.url)
  parsed.hash = ''
  const fields = request.fields ?? Object.entries(request.form ?? {}).map(([name, value]) => ({ name, value }))
  // Sorting keys is safe; the order of repeated values within a key is preserved.
  const ordered = fields.map((field, index) => ({ ...field, index })).sort((a, b) => a.name.localeCompare(b.name) || a.index - b.index)
  return JSON.stringify([request.method, parsed.href, ordered.map(({ name, value }) => [name, value])])
}

export function compactSearchTemplate(url: string, method: 'GET' | 'POST', fields: CatalogField[]): CatalogRequest {
  if (new Set(fields.map(field => field.name)).size !== fields.length) return { url, method, fields }
  if (!fields.length) return { url, method }
  const form: Record<string, string> = {}
  for (const field of fields) form[field.name] = field.value
  return { url, method, form }
}
