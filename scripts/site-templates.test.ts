import assert from 'node:assert/strict'
import { parseCatalogPage } from '../src/features/siteCatalog/service'
import type { NewsSource } from '../src/sources/registry'
const source: NewsSource = { id: 'custom_template', name: '模板', label: '模板', url: 'https://example.test/', kind: 'web-catalog', group: 'custom', enabled: true }
// Small original rendered fixtures based on the official template structures linked in docs/cms-catalog.md.
const typecho = '<meta name="generator" content="Typecho"><div role="main"><article class="post" itemtype="http://schema.org/BlogPosting"><h2 class="post-title" itemprop="name headline"><a itemprop="url" href="/slug-entry">正文标题</a></h2><ul class="post-meta"><li itemprop="author"><a itemprop="name" href="/author/editor/">作者名称</a></li><li><time datetime="2026-09-01">2026-09-01</time></li></ul><div class="post-content"><p>摘要正文</p><ul><li>正文要点</li></ul></div></article><ol class="page-navigator"><li class="current">1</li><li class="next"><a href="/page/2">后一页 &raquo;</a></li></ol></div>'
const page = parseCatalogPage(source, { method: 'GET', url: source.url }, typecho)
assert.equal(page.articles.length, 1, 'Typecho metadata author link is not another article')
assert.equal(page.articles[0].hasRealDate, true)
assert.equal(page.pagination.nextUrl, 'https://example.test/page/2')
const joomla = '<meta name="generator" content="Joomla!"><div class="com-content-category-blog blog"><div class="com-content-category-blog__items blog-items"><div class="com-content-category-blog__item blog-item"><div class="item-content"><h2><a href="/sample-slug">Joomla 正文</a></h2><p>正文摘要</p></div></div></div></div>'
assert.equal(parseCatalogPage(source, { method: 'GET', url: source.url }, joomla).articles.length, 1)
const drupal = '<meta name="generator" content="Drupal"><div class="view-content"><div class="views-row"><div class="views-field views-field-title"><span class="field-content"><a href="/news/slug">Drupal 正文</a></span></div><div class="views-field-body">文章摘要</div></div></div><nav class="pager"><ul class="pager__items"><li class="pager__item--next"><a href="?page=1" title="Go to next page">Next ›</a></li></ul></nav>'
const views = parseCatalogPage(source, { method: 'GET', url: source.url }, drupal)
assert.equal(views.articles.length, 1)
assert.equal(views.pagination.nextUrl, 'https://example.test/?page=1')
assert.deepEqual(views.profile.categories, [], 'Drupal pager navigation is not a category')
const dede = '<meta name="generator" content="DedeCMS"><div class="listbox"><ul class="e2"><li><a href="/article/11.html" class="title">织梦正文标题</a><p>正文介绍</p></li></ul></div><div class="dede_pages"><ul><li><a href="/list_1_2.html">下一页</a></li></ul></div>'
assert.equal(parseCatalogPage(source, { method: 'GET', url: source.url }, dede).articles.length, 1)
console.log('site catalog sourced template structures: Typecho, Joomla, Drupal Views, DedeCMS: ok')
