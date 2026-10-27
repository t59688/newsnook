import assert from 'node:assert/strict'
import { test } from 'node:test'
import { extractCatalog } from '../src/features/catalogEngine/engine'
import { discoverCatalogProfile, discoverCatalogPagination } from '../src/features/siteCatalog/capabilities'
import { normalizeCatalogProfile, catalogProfileFor } from '../src/features/siteCatalog/profile'
import { parseCatalogPage } from '../src/features/siteCatalog/service'
import type { NewsSource } from '../src/sources/registry'
const url='https://catalog.example/list-1.htm'
const card=(id:number)=>`<div class="col-xs-6 col-md-3"><div class="thumbnail"><a href="video-${id}.htm"><div class="image" style="background-image:url('/thumb/${id}.webp')"><span>HD</span></div></a><div class="caption title"><h5><a href="video-${id}.htm">Documentary ${id}</a></h5></div></div></div>`
const rows=(start:number)=>[0,1,2].map(i=>`<div class="row">${card(start+2*i)}${card(start+2*i+1)}</div>`).join('')
const pager=`<nav aria-label="Pages"><ul class="pagination1"><li class="page-item active"><a href="list-1.htm">1</a></li><li class="page-item"><a href="list-2.htm">2</a></li><li class="page-item"><a href="list-3.htm">3</a></li><li class="page-item"><a href="list-29387.htm">...29387</a></li><li class="page-item"><a href="list-2.htm">▶</a></li></ul></nav>`
const nav='<nav class="navbar"><ul><li><a href="list-1.htm">最新</a></li><li><a href="long_list-1.htm">10分钟/+</a></li></ul></nav>'
const source:NewsSource={id:'custom_layout',url,name:'Catalog',label:'Catalog',kind:'web-catalog',group:'custom',enabled:true}

test('responsive columns and repeated rows form one collection rather than one card',()=>{
 const html=`<div class="container">${rows(1)}</div><aside>${card(99)}</aside>`
 assert.deepEqual(extractCatalog(html,url).items.map(i=>i.originUrl),[1,2,3,4,5,6].map(id=>`https://catalog.example/video-${id}.htm`))
})
test('sibling main grid sections retain their cards but sidebar thumbnails stay excluded',()=>{
 const html=`<div class="container"><h2>Recent</h2>${rows(1)}</div><div class="container"><h2>Featured</h2>${rows(11)}</div><aside class="sidebar">${rows(101)}</aside>`
 assert.equal(extractCatalog(html,url).items.length,12)
})
test('an actual singleton semantic list remains valid',()=>{
 assert.equal(extractCatalog('<main><article><h2><a href="/post/1">One article</a></h2></article></main>',url,{minItems:1}).items.length,1)
})
test('pagination glyphs and ellipsis counts are never exposed as site categories',()=>{
 const profile=discoverCatalogProfile(nav+pager,url)
 assert.deepEqual(profile.categories.map(i=>i.title),['10分钟/+'])
 assert.equal(discoverCatalogPagination(pager,url).nextUrl,'https://catalog.example/list-2.htm')
 assert.ok(discoverCatalogPagination(pager,url).pages?.some(i=>i.page===3))
})
test('a last-page count is not a next-page action',()=>{
 const html='<nav aria-label="Pages"><div class="btn-group"><a aria-current="page" href="list-2.htm">2</a><a href="list-3.htm">3</a><a href="list-999.htm">...999</a></div></nav>'
 assert.equal(discoverCatalogPagination(html,'https://catalog.example/list-2.htm').nextUrl,'https://catalog.example/list-3.htm')
})
test('saved pagination pollution is repaired without dropping real categories',()=>{
 const categories=[{title:'10分钟/+',url:'https://catalog.example/long_list-1.htm'},{title:'...29387',url:'https://catalog.example/list-29387.htm'},{title:'▶',url:'https://catalog.example/list-2.htm'}]
 const profile={version:1,rulesRevision:1,siteRoot:'https://catalog.example/',engine:'generic',categories}
 assert.deepEqual(normalizeCatalogProfile(profile,url)?.categories.map(i=>i.title),['10分钟/+'])
 assert.deepEqual(catalogProfileFor({...source,frameworkHint:{framework:'generic',paginationPattern:{kind:'next-link'},categories}}).categories.map(i=>i.title),['10分钟/+'])
 const parsed=parseCatalogPage({...source,catalogProfile:profile as never},{url,method:'GET'},`<div class="container">${rows(1)}</div>`)
 assert.equal(parsed.articles.length,6)
 assert.deepEqual(parsed.profile.categories.map(i=>i.title),['10分钟/+'])
})

test('saved numeric editorial categories and year filters are not erased as page numbers',()=>{
 const profile=normalizeCatalogProfile({version:1,rulesRevision:1,siteRoot:'https://catalog.example/',engine:'generic',categories:[{title:'2026',url:'https://catalog.example/year/2026'}],filters:[{title:'年份',options:[{title:'2024',url:'https://catalog.example/list?year=2024'}]}]},url)
 assert.equal(profile?.categories[0]?.title,'2026')
 assert.equal(profile?.filters?.[0]?.options[0]?.title,'2024')
})
