import assert from 'node:assert/strict'
import { CatalogSession } from '../src/features/siteCatalog/session'
import { parseCatalogPage } from '../src/features/siteCatalog/service'
import type { NewsSource } from '../src/sources/registry'
import type { CatalogRequest } from '../src/features/siteCatalog/types'

const source: NewsSource = { id: 'custom_real', name: '真实站点', label: '真实', url: 'https://example.test/', kind: 'web-catalog', group: 'custom', enabled: true }
const card = (id: number) => `<main><article><h2><a href="./post/${id}">Article ${id}</a></h2></article></main>`
const head = card(1) + '<a href="/page/2" rel="next">下一页</a>'
const page = parseCatalogPage(source, { method: 'GET', url: 'https://example.test/category/' }, head)
assert.equal(page.articles[0].id.startsWith('custom_real:'), true)
assert.equal(page.articles[0].originUrl, 'https://example.test/category/post/1')
assert.equal(page.pagination.nextUrl, 'https://example.test/page/2')
assert.equal(parseCatalogPage(source, { method: 'GET', url: source.url }, '<html><title>Just a moment...</title></html>').kind, 'blocked')
assert.equal(parseCatalogPage(source, { method: 'GET', url: source.url }, '<main><p>No results found</p></main>').kind, 'empty')

const requests: string[] = []
const session = new CatalogSession(source, async (request) => {
  requests.push(request.url)
  if (request.url.endsWith('/error')) throw new Error('upstream failed')
  return parseCatalogPage(source, request, request.url.endsWith('/page/2') ? card(2) : head)
})
await session.open({ method: 'GET', url: source.url })
await session.next()
assert.deepEqual(requests, ['https://example.test/', 'https://example.test/page/2'], 'next must fetch page 2 immediately')
assert.equal(session.snapshot.page?.articles[0].title, 'Article 2')
await session.open({ method: 'GET', url: 'https://example.test/error' })
assert.equal(session.snapshot.page?.articles[0].title, 'Article 2', 'errors retain the successful page')
assert.equal(session.snapshot.error, 'upstream failed')

let release: (() => void) | undefined
const raced = new CatalogSession(source, async (request: CatalogRequest) => {
  if (request.url.endsWith('/slow')) await new Promise<void>((resolve) => { release = resolve })
  return parseCatalogPage(source, request, card(request.url.endsWith('/slow') ? 1 : 2))
})
const slow = raced.open({ method: 'GET', url: 'https://example.test/slow' })
await raced.open({ method: 'GET', url: 'https://example.test/fast' })
release!()
await slow
assert.equal(raced.snapshot.page?.articles[0].title, 'Article 2', 'late responses must not overwrite the active request')
const loop = new CatalogSession(source, async (request) => parseCatalogPage(source, request, head))
await loop.open({ method: 'GET', url: source.url })
await loop.next()
assert.equal(loop.snapshot.exhausted, true, 'repeated next URL must stop')
session.cancel(); raced.cancel(); loop.cancel()
console.log('site catalog session: ok')

let retryFail = true
const retryPaging = new CatalogSession(source, async (request) => {
  if (request.url.endsWith('/page/2') && retryFail) throw new Error('temporary')
  return parseCatalogPage(source, request, request.url.endsWith('/page/2') ? card(2) : head)
})
await retryPaging.open({ method: 'GET', url: source.url })
await retryPaging.next()
retryFail = false
await retryPaging.retry()
assert.equal(retryPaging.snapshot.history.length, 2, 'next-page retry retains previous page')
retryPaging.previous()
assert.equal(retryPaging.snapshot.page?.articles[0].title, 'Article 1')
retryPaging.cancel()

const detailHtml = '<main><h1>Featured</h1></main><script type="application/ld+json">'+JSON.stringify({ '@type': 'Article', headline: 'Featured', url: 'https://example.test/featured' })+'</script>'
assert.equal(parseCatalogPage(source, { method: 'GET', url: 'https://example.test/featured?utm_source=x' }, detailHtml).kind, 'detail', 'tracking query does not turn a detail into collection')
const canonicalDetail = '<link rel="canonical" href="/featured">' + detailHtml
for (const suffix of ['?print=1', '/amp']) {
  assert.equal(parseCatalogPage(source, { method: 'GET', url: 'https://example.test/featured' + suffix }, canonicalDetail).kind, 'detail', 'canonical print and AMP details are not collections')
}
assert.equal(parseCatalogPage(source, { method: 'GET', url: source.url }, '<link rel="canonical" href="/">' + detailHtml).kind, 'catalog', 'collection canonical alone does not classify another article as current detail')

assert.equal(parseCatalogPage(source, { method: 'GET', url: 'https://example.test/list/' }, '<base href="./assets/">'+card(3)).articles[0].originUrl, 'https://example.test/list/assets/post/3', 'relative base is resolved once')
const knownVideo = { ...source, catalogProfile: { version: 1 as const, rulesRevision: 1 as const, siteRoot: source.url, engine: 'fyfcms' as const, categories: [] } }
const genericCard = '<main><li><h3><a href="/detail/one">资源标题</a></h3></li></main>'
assert.equal(parseCatalogPage(knownVideo, { method: 'GET', url: 'https://example.test/list/2' }, genericCard).articles[0].contentType, 'video', 'pages without identity markers retain validated source identity')
assert.equal(parseCatalogPage(knownVideo, { method: 'GET', url: 'https://example.test/list/2' }, '<meta name="generator" content="WordPress Typecho">'+genericCard).profile.engine, 'generic', 'explicit identity conflict does not inherit an older engine')
