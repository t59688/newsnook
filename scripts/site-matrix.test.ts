import assert from 'node:assert/strict'
import { parseCatalogPage } from '../src/features/siteCatalog/service'
import { discoverCatalogProfile, discoverCatalogPagination } from '../src/features/siteCatalog/capabilities'
import { probeCatalog } from '../src/features/siteCatalog/probe'
import type { NewsSource } from '../src/sources/registry'
const source: NewsSource = { id: 'custom_matrix', name: '矩阵', label: '矩阵', url: 'https://example.test/sub/list/', group: 'custom', kind: 'web-catalog', enabled: true }
const engines = [['MacCMS', 'maccms'], ['SeaCMS', 'seacms'], ['FeiFeiCMS', 'fyfcms'], ['ZanPianCMS', 'zanpian'], ['JEECMS', 'jeecms'], ['WordPress', 'wordpress'], ['Typecho', 'typecho'], ['DedeCMS', 'dedecms'], ['EmpireCMS', 'empirecms'], ['PbootCMS', 'pbootcms'], ['EyouCMS', 'eyoucms'], ['Z-BlogPHP', 'zblog'], ['Drupal', 'drupal'], ['Joomla!', 'joomla'], ['Hugo', 'hugo'], ['Hexo', 'hexo'], ['Ghost', 'ghost']]
for (const [name, engine] of engines) {
  for (const marker of [`<meta name="generator" content="${name}">`, `<meta CONTENT="${name} 1.0" NAME="generator">`]) {
    const html = marker + '<nav><a href="../category/news/">新闻</a></nav><main><article><h2><a href="../post/slug">正文条目</a></h2><p>有意义的简介内容</p></article></main><form action="../search" method="get"><input type="search" name="q"></form><div class="pagination"><a rel="NEXT" href="?offset=40">下一页</a></div>'
    const page = parseCatalogPage(source, { method: 'GET', url: source.url }, html)
    assert.equal(page.profile.engine, engine, name)
    assert.equal(page.articles.length, 1, name+' semantic catalog')
    assert.equal(page.articles[0].sourceId, source.id)
    assert.equal(page.pagination.nextUrl, source.url+'?offset=40', 'offset must use actual step')
    assert.equal(page.profile.search?.url, 'https://example.test/sub/search')
  }
  assert.equal(discoverCatalogProfile(`<p>文章中讨论 ${name}</p>`, source.url).engine, 'generic', name+' plain mention is not identity')
}
assert.equal(discoverCatalogProfile('<meta name="generator" content="MacCMS WordPress"><div class="stui-vodlist"></div>', source.url).engine, 'generic', 'conflicting explicit identities stay uncertain')
assert.equal(discoverCatalogPagination('<div class="pagination"><span class="active">2</span><a href="?offset=60">3</a></div>', source.url).nextUrl, source.url+'?offset=60')
assert.equal(discoverCatalogPagination('<base href="https://evil.test/"><a rel="next" href="?p=2">下一页</a>', source.url).nextUrl, source.url+'?p=2', 'cross-origin base ignored')
const home = '<nav>'+Array.from({length:8},(_,i)=>`<a href="/category/${i}">栏目${i}</a>`).join('')+'</nav>'
let attempts = 0
await probeCatalog(source, home, undefined, async (_source, request) => { attempts++; return parseCatalogPage(source, request, '<p>unknown</p>') })
assert.equal(attempts, 3, 'probe never follows more than three observed categories')
console.log('site catalog CMS matrix: 17 engines × 2 generator variants, observed routes, negative controls: ok')
