import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCatalogPage } from '../src/features/siteCatalog/service'
import { catalogSearchRequest } from '../src/features/siteCatalog/requests'
import type { NewsSource } from '../src/sources/registry'

const source: NewsSource = { id: 'capabilities', name: 'Catalog', label: 'Catalog', url: 'https://catalog.example/', group: 'custom', kind: 'web-catalog', enabled: true }
const content = '<main><article><h2><a href="/posts/story">An actual story</a></h2></article></main>'
const parse = (html: string, url = 'https://catalog.example/list?year=2025&area=CN', method: 'GET' | 'POST' = 'GET', fields?: { name: string; value: string }[]) => parseCatalogPage(source, { url, method, ...(fields ? { fields } : {}) }, html + content)
function abilities(page: ReturnType<typeof parse>) {
  assert.ok(page.capabilities, 'every parsed catalog page must expose response-local executable capabilities')
  return page.capabilities
}
function control(page: ReturnType<typeof parse>, semantic: string) {
  const found = abilities(page).controls.find(item => item.semantic === semantic)
  assert.ok(found, `missing ${semantic} control`)
  return found
}
function choice(page: ReturnType<typeof parse>, semantic: string, title: string) {
  const found = control(page, semantic).choices.find(item => item.title === title)
  assert.ok(found, `missing ${semantic}/${title}`)
  return found
}
const fieldsOf = (request: { url: string; method: string; fields?: { name: string; value: string }[]; form?: Record<string,string> }) => request.method === 'GET'
  ? [...new URL(request.url).searchParams].map(([name,value]) => ({ name, value }))
  : request.fields ?? Object.entries(request.form ?? {}).map(([name,value]) => ({ name, value }))
const values = (request: Parameters<typeof fieldsOf>[0], key: string) => fieldsOf(request).filter(item => item.name === key).map(item => item.value)

test('labelled rows keep numeric years and separate dimensions with arbitrary classes', () => {
  const page = parse(`<div class="random-382"><dl><dt>年份</dt><dd><a href="?year=&area=CN">全部</a><a class="active" href="?year=2025&area=CN">2025</a><a href="?year=2026&area=CN">2026</a></dd></dl><dl><dt>地区</dt><dd><a class="active" href="?year=2025&area=CN">中国</a><a href="?year=2025&area=US">美国</a></dd></dl></div>`)
  assert.equal(choice(page,'year','2025').selected,true)
  assert.equal(choice(page,'year','2026').request.url,'https://catalog.example/list?year=2026&area=CN')
  assert.equal(choice(page,'region','美国').request.url,'https://catalog.example/list?year=2025&area=US')
  assert.equal(page.pagination.nextUrl,undefined)
  assert.equal(page.profile.categories.some(item=>/202[56]|美国/.test(item.title)),false)
  assert.equal(page.articles.length,1)
  assert.ok(control(page,'year').evidence.signals.length >= 2)
})

test('minimal grouping does not merge different filter rows into one large box', () => {
 const page=parse(`<div class="filters"><ul><li><span>年份：</span><a href="?year=2025">2025</a><a href="?year=2026">2026</a></li><li><span>语言：</span><a href="?lang=zh">中文</a><a href="?lang=en">English</a></li></ul></div>`)
 assert.deepEqual(abilities(page).controls.map(item=>item.semantic).sort(),['language','year'])
 assert.equal(control(page,'year').choices.length,2)
})

test('path-based and signed links are preserved verbatim rather than synthesized', () => {
 const page=parse('<section><div><strong>年份</strong><a href="/show/2-CN--2025---.html?sig=A%2fB&z=2&z=1">2025</a><a href="/show/2-CN--2026---.html?sig=C%2fD&z=2&z=1">2026</a></div></section>')
 assert.equal(choice(page,'year','2026').request.url,'https://catalog.example/show/2-CN--2026---.html?sig=C%2fD&z=2&z=1')
})

test('query-family evidence discovers an unlabelled standard year control without confusing pagination', () => {
 const page=parse('<div><a href="?year=2024&area=CN">2024</a><a href="?year=2025&area=CN">2025</a><a href="?year=2026&area=CN">2026</a></div><nav class="pagination"><a aria-current="page" href="?year=2025&area=CN&page=1">1</a><a rel="next" href="?year=2025&area=CN&page=2">2</a></nav>')
 assert.equal(control(page,'year').choices.length,3)
 assert.equal(page.pagination.nextUrl,'https://catalog.example/list?year=2025&area=CN&page=2')
})

test('a generic parameter gets its meaning from the label instead of CMS-specific URL guesses', () => {
 const page=parse('<div><label>年份</label><a href="/filter?f=2025">2025</a><a href="/filter?f=2026">2026</a></div>')
 assert.equal(choice(page,'year','2026').request.url,'https://catalog.example/filter?f=2026')
})

test('standard GET select controls submit the complete successful form', () => {
 const page=parse(`<form action="/browse?route=collection" method="GET"><label for="yr">年份</label><select name="year" id="yr"><option value="">全部</option><option value="2025" selected>2025</option><option value="2026">2026</option></select><label>地区<select name="area"><option value="CN" selected>中国</option><option value="US">美国</option></select></label><input type="hidden" name="type" value="film"><button type="submit" name="op" value="filter">筛选</button></form>`)
 const request=choice(page,'year','2026').request
 assert.equal(request.method,'GET')
 assert.equal(new URL(request.url).pathname,'/browse')
 assert.deepEqual(values(request,'year'),['2026'])
 assert.deepEqual(values(request,'area'),['CN'])
 assert.deepEqual(values(request,'type'),['film'])
 assert.deepEqual(values(request,'route'),['collection'])
 assert.deepEqual(values(request,'op'),['filter'])
})

test('search keeps select/radio/checked values and repeated fields with correct encoding', () => {
 const page=parse(`<form action="/search?route=vod" role="search"><input name="q" type="search"><select name="year"><option value="2025" selected>2025</option><option value="2026">2026</option></select><input name="category[]" type="hidden" value="film"><input name="category[]" type="hidden" value="series"><input name="lang" type="radio" value="zh" checked><input name="lang" type="radio" value="en"><input name="available" type="checkbox" value="1" checked><input name="preview" type="checkbox" value="1"></form>`)
 const request=catalogSearchRequest(abilities(page),'中文 a&b')
 assert.ok(request)
 assert.deepEqual(values(request,'q'),['中文 a&b'])
 assert.deepEqual(values(request,'year'),['2025'])
 assert.deepEqual(values(request,'category[]'),['film','series'])
 assert.deepEqual(values(request,'lang'),['zh'])
 assert.deepEqual(values(request,'available'),['1'])
 assert.deepEqual(values(request,'preview'),[])
})

test('POST select operation keeps method and body even when the action URL stays the same', () => {
 const page=parse(`<form action="/filter" method="post"><label>年份<select name="year"><option value="2025" selected>2025</option><option value="2026">2026</option></select></label><input name="category[]" type="hidden" value="film"><input name="category[]" type="hidden" value="series"><input name="wd" value="unchanged"></form>`)
 const request=choice(page,'year','2026').request
 assert.equal(request.method,'POST')
 assert.equal(request.url,'https://catalog.example/filter')
 assert.deepEqual(values(request,'category[]'),['film','series'])
 assert.deepEqual(values(request,'wd'),['unchanged'])
})

test('multi-select and checkbox choices toggle only their own value', () => {
 const page=parse(`<form action="/browse"><label>类型<select name="genre[]" multiple><option value="action" selected>动作</option><option value="comedy" selected>喜剧</option><option value="drama">剧情</option></select></label><fieldset><legend>语言</legend><label><input name="lang[]" type="checkbox" value="zh" checked>中文</label><label><input name="lang[]" type="checkbox" value="en">英文</label></fieldset></form>`)
 assert.equal(control(page,'genre').selection,'multiple')
 assert.deepEqual(values(choice(page,'genre','剧情').request,'genre[]'),['action','comedy','drama'])
 assert.deepEqual(values(choice(page,'genre','动作').request,'genre[]'),['comedy'])
 assert.deepEqual(values(choice(page,'language','英文').request,'lang[]'),['zh','en'])
})

test('form-associated controls outside a form and disabled fieldset semantics are honored', () => {
 const page=parse(`<form id="filters" action="/browse"><label>年份<select name="year"><option value="2025">2025</option><option value="2026">2026</option></select></label><fieldset disabled><legend><input name="legend" value="keep"></legend><input name="disabled" value="never"><select name="lang"><option value="bad">bad</option></select></fieldset><input name="ignored" disabled value="no"></form><input form="filters" type="hidden" name="area" value="CN"><input type="hidden" name="unowned" value="no">`)
 const request=choice(page,'year','2026').request
 assert.deepEqual(values(request,'area'),['CN'])
 assert.deepEqual(values(request,'legend'),['keep'])
 assert.deepEqual(values(request,'disabled'),[])
 assert.deepEqual(values(request,'ignored'),[])
 assert.deepEqual(values(request,'unowned'),[])
 assert.equal(abilities(page).controls.some(item=>item.semantic==='language'),false)
})

test('disabled options and placeholder options are not executable actions', () => {
 const page=parse('<form action="/browse"><label>年份<select name="year"><option value="" disabled selected>请选择</option><option value="2025">2025</option><optgroup disabled><option value="2026">2026</option></optgroup></select></label></form>')
 assert.deepEqual(control(page,'year').choices.map(item=>item.title),['2025'])
})

test('sorting keeps observed values and does not appear as category or content', () => {
 const page=parse('<nav><a href="/films">电影</a></nav><div class="opaque"><strong>排序</strong><a href="?year=2025&area=CN&by=time">最新</a><a href="?year=2025&area=CN&by=score">评分</a><a href="?year=2025&area=CN&by=hits">热度</a></div>')
 assert.equal(control(page,'sort').choices.length,3)
 assert.deepEqual(values(choice(page,'sort','评分').request,'by'),['score'])
 assert.equal(page.profile.categories.some(item=>item.title==='评分'),false)
 assert.equal(page.articles.length,1)
})

test('identity and ordinary text alone do not invent facets, search endpoints or actions', () => {
 const page=parse('<meta name="generator" content="MacCMS"><p>年份、地区、排行榜和搜索都在这篇文章中被讨论。</p>')
 assert.deepEqual(abilities(page).controls,[])
 assert.equal(abilities(page).search,undefined)
 assert.equal(page.profile.search,undefined)
})

test('unsafe, sensitive, credentialed and mutating forms cannot become executable catalog controls', () => {
 const forms=[
  '<form action="/login" method="post"><input name="q"><input type="password" name="password"></form>',
  '<form action="/search"><input name="q"><input type="hidden" name="csrf_token" value="secret"></form>',
  '<form action="https://evil.example/search"><input name="q"></form>',
  '<form action="/delete" method="post"><select name="year"><option>2025</option><option>2026</option></select><button>删除</button></form>',
  '<form action="/upload" enctype="multipart/form-data"><input name="q"><input type="file" name="file"></form>',
  '<form action="/search?PHPSESSID=secret"><input name="q"></form>',
 ]
 for(const form of forms){const page=parse(form);assert.equal(abilities(page).search,undefined,form);assert.deepEqual(abilities(page).controls,[],form);assert.equal(JSON.stringify(page.profile).includes('secret'),false)}
})

test('JavaScript-only controls report a non-executable limitation instead of fictitious URLs', () => {
 const page=parse('<div class="filters"><label>年份</label><button onclick="filter(2025)">2025</button><button onclick="filter(2026)">2026</button></div>')
 assert.deepEqual(abilities(page).controls,[])
 assert.ok(abilities(page).issues.some(item=>item.reason==='javascript-control'))
})

test('card badges, release-year headlines, related lists and arbitrary navigation are not facets', () => {
 const page=parse('<nav><a href="/archive/2025">2025</a><a href="/archive/2026">2026</a></nav><aside><h3>年份</h3><a href="?year=2025">2025</a><a href="?year=2026">2026</a></aside><article><h2>年份</h2><p>2025 年与 2026 年</p><a href="/posts/2025">2025</a><a href="/posts/2026">2026</a></article>')
 assert.deepEqual(abilities(page).controls,[])
})

test('large control sets are bounded and malformed external links never enter requests', () => {
 const links=Array.from({length:500},(_,i)=>`<a href="?year=${1900+i}">${1900+i}</a>`).join('')
 const page=parse('<dl><dt>年份</dt><dd>'+links+'<a href="javascript:alert(1)">2026</a><a href="https://evil.example/?year=2026">2026</a></dd></dl>')
 const year=control(page,'year')
 assert.ok(year.choices.length<=100)
 assert.ok(year.choices.every(item=>new URL(item.request.url).origin==='https://catalog.example'))
})

test('a large filter row is not rescanned as a potential pager for every sibling option', async () => {
 const {catalogDocument}=await import('../src/features/catalogEngine/extractors/domCards')
 const {discoverPageCapabilities}=await import('../src/features/siteCatalog/abilities/discover')
 const document=catalogDocument('<dl><dt>年份</dt><dd>'+Array.from({length:150},(_,i)=>`<a href="?year=${1900+i}">${1900+i}</a>`).join('')+'</dd></dl>')
 let inspections=0
 for(const node of document.querySelectorAll('*')){
  const query=node.querySelectorAll.bind(node)
  node.querySelectorAll=((selector:string)=>{if(selector===':scope > a[href], :scope > li > a[href]')inspections++;return query(selector)}) as typeof node.querySelectorAll
 }
 const result=discoverPageCapabilities(document,'https://catalog.example/','generic',{url:'https://catalog.example/',method:'GET'})
 assert.equal(result.controls[0].semantic,'year')
 assert.ok(inspections<=12,`pager region discovery should be cached per extraction, got ${inspections} repeated scans`)
})

test('settings and ambiguous POST forms are not replayed as read-only filters', () => {
 for(const action of ['/account/settings','/preferences','/profile/edit','/unknown-operation']){
  const page=parse(`<form action="${action}" method="post"><label>语言<select name="language"><option>中文</option><option>英文</option></select></label><button name="save" value="1">Save</button></form>`)
  assert.deepEqual(abilities(page).controls,[],action)
  assert.ok(abilities(page).issues.some(issue=>issue.reason==='unsafe-form'),action)
 }
 const ambiguous=parse('<form action="/action" method="post"><label>年份<select name="year"><option>2025</option><option>2026</option></select></label></form>')
 assert.deepEqual(abilities(ambiguous).controls,[],'POST requires a positive read/search/filter intent, not only a field name')
})

test('semantic primary Categories navigation is not consumed as a facet group', () => {
 const page=parse('<nav><ul aria-label="Categories"><li><a href="/news">News</a></li><li><a href="/reviews">Reviews</a></li></ul></nav>')
 assert.equal(abilities(page).controls.length,0)
 assert.deepEqual(page.profile.categories.map(item=>item.title),['News','Reviews'])
})

test('observed pagination submitter overrides action and method while keeping repeated fields', () => {
 const page=parse('<form class="pagination" action="/list" method="get"><input type="hidden" name="tag[]" value="code"><input type="hidden" name="tag[]" value="science"><button formaction="/list/next" formmethod="post" name="cursor" value="two">Next</button></form>')
 assert.equal(page.pagination.nextRequest?.method,'POST')
 assert.equal(page.pagination.nextRequest?.url,'https://catalog.example/list/next')
 assert.deepEqual(values(page.pagination.nextRequest!,'tag[]'),['code','science'])
 assert.deepEqual(values(page.pagination.nextRequest!,'cursor'),['two'])
})
