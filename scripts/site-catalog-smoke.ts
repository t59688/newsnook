/** Optional live check; offline regression tests never depend on a changing website. */
import assert from 'node:assert/strict'
import { parseCatalogPage } from '../src/features/siteCatalog/service'
import { catalogSearchRequest } from '../src/features/siteCatalog/requests'
import type { NewsSource } from '../src/sources/registry'
const url = process.argv[2] ?? 'https://www.xiangguys.com/'
const response = await fetch(url, { signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'Mozilla/5.0' } })
assert.ok(response.ok, 'live homepage HTTP '+response.status)
const html = await response.text()
const source: NewsSource = { id: 'custom_live', name: 'Live', label: 'Live', group: 'custom', kind: 'web-catalog', enabled: true, url: response.url }
const head = parseCatalogPage(source, { method: 'GET', url }, html, response.url)
assert.equal(head.kind, 'catalog')
assert.ok(head.articles.length)
console.log(JSON.stringify({ page: head.url, engine: head.profile.engine, count: head.articles.length, categories: head.profile.categories.length, search: head.profile.search?.method }))
const query = head.articles[0].title.slice(0, 2)
const searchRequest = catalogSearchRequest(head.profile, query)
if (searchRequest) {
  const form = new URLSearchParams()
  for (const field of searchRequest.fields ?? Object.entries(searchRequest.form ?? {}).map(([name, value]) => ({ name, value }))) form.append(field.name, field.value)
  const searchResponse = await fetch(searchRequest.url, { method: searchRequest.method, ...(searchRequest.method === 'POST' ? { body: form } : {}), signal: AbortSignal.timeout(25000) })
  assert.ok(searchResponse.ok)
  const search = parseCatalogPage({ ...source, catalogProfile: head.profile }, searchRequest, await searchResponse.text(), searchResponse.url)
  assert.equal(search.kind, 'catalog', 'live observed search returns readable results')
  assert.ok(search.articles.every((article) => article.sourceId === source.id))
  console.log(JSON.stringify({ search: searchRequest.method, count: search.articles.length, stableSource: true }))
}
const category = head.profile.categories[0]
if (category) {
  const categoryResponse = await fetch(category.url, { signal: AbortSignal.timeout(25000) })
  assert.ok(categoryResponse.ok)
  const page = parseCatalogPage({ ...source, catalogProfile: head.profile }, { method: 'GET', url: category.url }, await categoryResponse.text(), categoryResponse.url)
  assert.equal(page.kind, 'catalog')
  assert.ok(page.articles.length)
  console.log(JSON.stringify({ page: page.url, count: page.articles.length, next: page.pagination.nextUrl, types: [...new Set(page.articles.map((article) => article.contentType))] }))
  if (page.pagination.nextUrl) {
    const next = await fetch(page.pagination.nextUrl, { signal: AbortSignal.timeout(25000) })
    assert.ok(next.ok)
    const parsed = parseCatalogPage(source, { method: 'GET', url: page.pagination.nextUrl }, await next.text(), next.url)
    assert.ok(parsed.articles.some((article) => !page.articles.some((old) => old.id === article.id)), 'next page contains new items')
    console.log(JSON.stringify({ page: parsed.url, count: parsed.articles.length, advanced: true }))
  }
}
