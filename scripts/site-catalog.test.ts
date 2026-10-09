import assert from 'node:assert/strict'
import { extractCatalog } from '../src/features/catalogEngine/engine'
import { catalogHtmlToArticles } from '../src/features/catalogEngine/toArticles'
import type { NewsSource } from '../src/sources/registry'
import { migrateCatalogCache } from '../src/features/siteCatalog/cache'
import { extractRelatedCatalog } from '../src/features/catalogEngine/related'

const source: NewsSource = { id: 'custom_blog', name: '博客', label: '博客', group: 'custom', kind: 'web-catalog', url: 'https://example.test/', enabled: true }
const slugHtml = ['alpha', 'beta', 'gamma'].map((slug) => `<article><h2><a href="/posts/${slug}">${slug} article</a></h2><p class="summary">An independent article summary</p><time datetime="2026-09-01">2026-09-01</time></article>`).join('')
assert.equal(extractCatalog(slugHtml, source.url).items.length, 3, 'semantic slug cards must not depend on numeric URL IDs')
assert.equal(catalogHtmlToArticles(source, slugHtml, 0)[0].contentType, 'article', 'text CMS entries must use article reader')
assert.equal(extractCatalog(slugHtml, source.url).items[0].publishedAt, Date.parse('2026-09-01'))

const one = '<main><article><h2><a href="./entry">Single result</a></h2></article></main>'
assert.equal(extractCatalog(one, source.url, { minItems: 1 }).items.length, 1, 'single search card must survive')
assert.equal(catalogHtmlToArticles(source, one, 0, 'https://example.test/search/')[0].originUrl, 'https://example.test/search/entry', 'relative links must use fetched page URL')

const caseHtml = `<script type="application/ld+json">${JSON.stringify({ '@type': 'ItemList', itemListElement: ['Alpha', 'alpha', 'Beta'].map((name) => ({ '@type': 'ListItem', item: { '@type': 'Article', headline: name, url: 'https://example.test/posts/' + name } })) })}</script>`
assert.equal(extractCatalog(caseHtml, source.url).items.length, 3, 'URL path case must not be collapsed')
assert.equal(catalogHtmlToArticles(source, caseHtml, 0)[0].contentType, 'article')
const long = Array.from({ length: 205 }, (_, i) => `<article><h2><a href="/posts/entry-${i}">Article ${i}</a></h2></article>`).join('')
assert.equal(extractCatalog(long, source.url).items.length, 200)
assert.equal(extractCatalog(long, source.url).truncated, true, 'bounded extraction must report truncation')
const split = '<main><article><a href="/posts/one"><img data-src="/cover.jpg"></a><h2><a href="/posts/one">Actual title</a></h2></article></main>'
assert.equal(extractCatalog(split, source.url, { minItems: 1 }).items[0]?.image, 'https://example.test/cover.jpg')
assert.equal(extractCatalog(split, source.url, { minItems: 1 }).items[0]?.title, 'Actual title')
assert.equal(extractCatalog('<nav><a href="/categories/a">栏目甲</a><a href="/categories/b">栏目乙</a><a href="/categories/c">栏目丙</a></nav>', source.url).items.length, 0, 'navigation is not catalog content')
console.log('site catalog extraction: ok')

const panel = (offset: number) => '<section><div class="panel-main"><ul class="thumbnail-group">'+Array.from({length:3},(_,i)=>`<li><a href="/video/${offset+i}"><img data-original="/cover.jpg"></a><h5><a href="/video/${offset+i}">影片 ${offset+i}</a></h5></li>`).join('')+'</ul></div><div class="panel-aside"><ul><li><h3><a href="/video/rank">排行榜噪音</a></h3></li></ul></div></section>'
assert.equal(extractCatalog(panel(10)+panel(20), source.url).items.length, 6, 'repeated content panels are combined without sidebar rankings')

const bullets = ['alpha', 'beta', 'gamma'].map((slug) => `<article><h2><a href="/posts/${slug}">${slug} title</a></h2><p>摘要</p><ul><li>摘要中的要点</li></ul></article>`).join('')
assert.equal(extractCatalog(bullets, source.url).items.length, 3, 'excerpt bullet lists must not hide outer article cards')
const featured = '<script type="application/ld+json">'+JSON.stringify({ '@type': 'Article', headline: 'Featured', url: '/posts/featured' })+'</script>'
assert.equal(extractCatalog(featured+slugHtml, source.url, { minItems: 1 }).items.length, 3, 'standalone featured metadata must not replace actual collection')
const mac: NewsSource = { ...source, frameworkHint: { framework: 'maccms', paginationPattern: { kind: 'next-link' } } }
const classic = '<ul class="stui-vodlist"><li><a href="/index.php/vod/detail/id/1.html" title="测试影片"><img src="/cover.jpg"></a><h3><a href="/index.php/vod/detail/id/1.html">测试影片</a></h3></li></ul>'
assert.equal(catalogHtmlToArticles(mac, classic, 0)[0].contentType, 'video', 'classic video routes enter the existing video reader')

const withBase = '<base href="./assets/">'+one
assert.equal(extractCatalog(withBase, 'https://example.test/list/', { minItems: 1 }).items[0].originUrl, 'https://example.test/list/assets/entry')

const textInMac = catalogHtmlToArticles(mac, '<article><h2><a href="/index.php/art/detail/id/1.html">影视资讯正文</a></h2></article>', 0)
assert.equal(migrateCatalogCache(mac, textInMac)[0].contentType, 'article', 'mixed CMS migration preserves explicit article evidence')
assert.equal(migrateCatalogCache(mac, [{ ...textInMac[0], contentType: 'video' }])[0].contentType, 'article', 'legacy art routes repair all-video metadata')
assert.equal(catalogHtmlToArticles(mac, '<ul class="stui-vodlist"><li><h3><a href="/index.php/art/detail/id/1.html">影视图文资讯</a></h3></li></ul>', 0)[0].contentType, 'article', 'text routes override a shared video theme in a mixed CMS')
const related = '<main><div class="post-list"><article><h2><a href="/posts/main">主目录正文</a></h2></article></div><div class="related"><article><h2><a href="/posts/related">相关阅读正文</a></h2></article></div></main>'
assert.deepEqual(extractCatalog(related, source.url).items.map((item) => item.originUrl), ['https://example.test/posts/main'], 'related cards do not pollute primary collection')
assert.equal(extractRelatedCatalog(caseHtml, 'https://example.test/posts/Alpha').length, 2, 'related exclusions preserve URL path case')
assert.equal(catalogHtmlToArticles({ ...mac, catalogProfile: { version: 1, rulesRevision: 1, siteRoot: source.url, engine: 'wordpress', categories: [] } }, '<div class="card"><h3><a href="/entry">普通正文</a></h3></div>', 0)[0].contentType, 'article', 'current profile takes precedence over a legacy hint')
