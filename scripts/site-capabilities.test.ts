import assert from 'node:assert/strict'
import { detectFramework } from '../src/features/frameworkDetect/detect'
import { discoverCatalogProfile, discoverCatalogPagination } from '../src/features/siteCatalog/capabilities'
import { catalogSearchRequest } from '../src/features/siteCatalog/requests'

assert.equal(detectFramework('<script>var zanpian={};</script><script src="/static/js/home.js"></script><div class="stui-vodlist"><a href="/vodtype/1/">电影</a></div>', 'https://example.test/')?.framework, 'zanpian', 'explicit identity must beat shared MacCMS theme')
assert.equal(detectFramework('<meta content="WordPress 6" name="generator">', 'https://example.test/blog/')?.framework, 'wordpress', 'generator attribute ordering must not matter')
for (const [name, id] of [['Typecho', 'typecho'], ['PbootCMS', 'pbootcms'], ['DedeCMS', 'dedecms'], ['EmpireCMS', 'empirecms'], ['EyouCMS', 'eyoucms'], ['Z-BlogPHP', 'zblog'], ['Drupal', 'drupal'], ['Joomla!', 'joomla']]) {
  assert.equal(detectFramework(`<meta content="${name}" name="generator">`, 'https://example.test/')?.framework, id, name + ' generator identity')
}
assert.equal(detectFramework('<script src="/Public/js/system.js"></script><script>var cms={root:"/"};</script><form class="ff-search" data-action="/vod-search-wd-FFWD.html"></form>', 'https://example.test/')?.framework, 'fyfcms')
console.log('site catalog engine identity: ok')

const url = 'https://example.test/blog/list/'
const html = `<meta content="Typecho" name="generator"><nav><a href="/blog/">首页</a><a href="/blog/category/news/">新闻</a><a href="/blog/category/tools/">工具</a></nav><form action="/blog/search" method="post" role="search"><input type="hidden" name="scope" value="posts"><input name="q" type="search"></form><div class="pagination"><a href="?page=1">1</a><a href="?page=2">2</a><a rel="next" href="?page=2" aria-label="Next page"><i></i></a></div>`
const profile = discoverCatalogProfile(html, url)
assert.equal(profile.engine, 'typecho')
assert.deepEqual(profile.categories.map((c) => c.url), ['https://example.test/blog/category/news/', 'https://example.test/blog/category/tools/'])
assert.deepEqual(catalogSearchRequest(profile, '中文 a&b'), { method: 'POST', url: 'https://example.test/blog/search', form: { scope: 'posts', q: '中文 a&b' } })
assert.equal(discoverCatalogPagination(html, url).nextUrl, 'https://example.test/blog/list/?page=2')
assert.equal(discoverCatalogPagination('<a class="disabled" href="?page=2">下一页</a>', url).kind, 'none')
assert.equal(discoverCatalogPagination('<a href="https://other.test/">下一页</a>', url).kind, 'none')
const get = discoverCatalogProfile('<form action="/sub/index.php?route=search"><input name="keyword" type="search"></form>', url)
assert.equal(catalogSearchRequest(get, 'a&中')?.url, 'https://example.test/sub/index.php?route=search&keyword=a%26%E4%B8%AD')
const fyf = discoverCatalogProfile('<form class="ff-search" action="/index.php?s=vod-search" method="post" data-action="/vod-search-wd-FFWD.html"><input name="wd"></form>', url)
assert.equal(catalogSearchRequest(fyf, '中文')?.url, 'https://example.test/vod-search-wd-%E4%B8%AD%E6%96%87.html')
assert.equal(discoverCatalogProfile('<meta name="generator" content="WordPress">', url).search, undefined, 'CMS name alone must not invent search support')
console.log('site catalog observed capabilities: ok')

const repeated = discoverCatalogProfile('<form action="/search" method="post"><input name="q"><input name="category[]" type="hidden" value="news"><input name="category[]" type="hidden" value="tools"></form>', url)
assert.deepEqual(catalogSearchRequest(repeated, '中文')?.fields, [{ name: 'category[]', value: 'news' }, { name: 'category[]', value: 'tools' }, { name: 'q', value: '中文' }])
const repeatedGet = catalogSearchRequest({ ...repeated, search: { ...repeated.search!, method: 'GET' } }, '中文')!
assert.deepEqual(new URL(repeatedGet.url).searchParams.getAll('category[]'), ['news', 'tools'])
assert.equal(discoverCatalogProfile('<form action="/search" method="post"><input name="q"><input type="hidden" name="csrf_token" value="session-only"></form>', url).search, undefined, 'session-dependent forms must not advertise an unusable persisted search')
assert.equal(discoverCatalogProfile('<form action="/search?csrf_token=session-only"><input name="q"></form>', url).search, undefined, 'action query session fields are not persisted')
for (const key of ['PHPSESSID', 'JSESSIONID', 'session_id']) {
  assert.equal(discoverCatalogProfile(`<form action="/search?${key}=session-only"><input name="q"></form>`, url).search, undefined)
  assert.equal(discoverCatalogProfile(`<form action="/search"><input name="q"><input type="hidden" name="${key}" value="session-only"></form>`, url).search, undefined)
}
