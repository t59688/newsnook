import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCatalogPage } from '../src/features/siteCatalog/service'
import { discoverCatalogProfile } from '../src/features/siteCatalog/capabilities'
import { extractCatalog } from '../src/features/catalogEngine/engine'
import { CatalogSession } from '../src/features/siteCatalog/session'
import type { NewsSource } from '../src/sources/registry'

const source: NewsSource = {id:'navigation_fixture',name:'Fixture',label:'Fixture',group:'custom',kind:'web-catalog',enabled:true,url:'https://catalog.example/'}
const primary = (active = 'charts') => `<header><nav class="navbar"><ul>${[['films','电影','/films/'],['charts','榜单','/charts/'],['specials','专题','/specials/']].map(([key,title,href])=>`<li class="${key===active?'active':''}"><a href="${href}">${title}</a></li>`).join('')}</ul></nav></header>`
const sub = (active = 'all', cls = 'box-title-nav') => `<div class="${cls}"><ul>${[['all','全部榜单','/charts/'],['film','电影榜单','/charts/film.html'],['series','电视剧榜单','/charts/series.html']].map(([key,title,href])=>`<li><a class="${key===active?'active':''}" href="${href}">${title}</a></li>`).join('')}</ul></div>`
const poster = (id:number, cls='layout-piece') => `<div class="${cls}"><a class="video-pic" data-original="/poster/${id}.jpg" href="/data/film-${id}.html"><span class="top"><em>${id}</em></span><span class="player"></span><span class="note">1080P</span></a><div class="title"><h5><a href="/data/film-${id}.html">Film ${id}</a></h5></div></div>`
const rankList = (start:number) => `<section><h2>Ranking group ${start}</h2><div class="box-video-text-list"><ul>${[start,start+1,start+2].map(id=>`<li><a href="/data/film-${id}.html" title="Film ${id}"><em class="num">${id-start+1}</em>Film ${id}</a><span class="hits">100</span></li>`).join('')}</ul></div></section>`
const page = (html:string,path='/charts/') => parseCatalogPage(source,{method:'GET',url:new URL(path,source.url).href},html)

test('primary navigation retains the active page instead of dropping its own link',()=>{
 assert.deepEqual(discoverCatalogProfile(primary(),'https://catalog.example/charts/').categories.map(link=>link.title),['电影','榜单','专题'])
})
test('contextual navigation is separate from primary entries and knows its parent',()=>{
 const p=page(primary()+sub('film')+`<main>${poster(1)}${poster(2)}</main>`,'/charts/film.html')
 assert.deepEqual(p.profile.categories.map(link=>link.title),['电影','榜单','专题'])
 assert.equal(p.navigation?.activePrimaryUrl,'https://catalog.example/charts/')
 assert.deepEqual(p.navigation?.groups[0]?.links.map(link=>link.title),['全部榜单','电影榜单','电视剧榜单'])
 assert.equal(p.navigation?.groups[0]?.activeUrl,'https://catalog.example/charts/film.html')
})
test('nested semantic menus do not flatten child sections into primary navigation',()=>{
 const html='<header><nav><ul><li><a href="/films/">电影</a></li><li class="active"><a href="/charts/">榜单</a><ul><li><a href="/charts/daily/">日榜</a></li><li><a aria-current="page" href="/charts/weekly/">周榜</a></li></ul></li></ul></nav></header>'+poster(1)
 const p=page(html,'/charts/weekly/')
 assert.deepEqual(p.profile.categories.map(link=>link.title),['电影','榜单'])
 assert.deepEqual(p.navigation?.groups[0]?.links.map(link=>link.title),['日榜','周榜'])
})
test('a valid navigation landing page is not a network or extraction error',()=>{
 const p=page(primary()+sub())
 assert.equal(p.kind,'navigation')
 assert.equal(p.articles.length,0)
 assert.equal(p.navigation?.groups[0]?.links.length,3)
 assert.equal(page(primary()+'<p>Nothing readable here</p>').kind,'unsupported','global header alone is not a valid navigation landing')
})
test('plain ranked text lists are content even without headings or poster images per item',()=>{
 const p=page(primary()+sub()+`<main>${rankList(1)}${rankList(10)}</main><aside>${rankList(90)}</aside>`)
 assert.equal(p.kind,'catalog')
 assert.deepEqual(p.articles.map(a=>a.title),['Film 1','Film 2','Film 3','Film 10','Film 11','Film 12'])
})
test('paired poster and title infer cards without a CMS-specific container class',()=>{
 const p=page(primary()+sub('film')+`<div class="catalog-body">${[1,2,3,4].map(id=>poster(id,'col-md-2 col-xs-4 hotlist random')).join('')}</div>`,'/charts/film.html')
 assert.equal(p.kind,'catalog')
 assert.equal(p.articles.length,4)
 assert.ok(p.articles.every(a=>a.image&&a.contentType==='video'))
 assert.equal(p.articles[0].title,'Film 1')
})
test('navigation, pagination and sidebar links cannot be admitted as ranked content',()=>{
 const html=primary()+sub()+`<nav><ol><li><a href="/charts/daily/">日榜</a></li><li><a href="/charts/weekly/">周榜</a></li><li><a href="/charts/monthly/">月榜</a></li></ol></nav><aside>${rankList(90)}</aside><div class="pagination"><a href="?page=2">2</a><a href="?page=3">3</a><a href="?page=4">4</a></div>`
 assert.equal(extractCatalog(html,'https://catalog.example/charts/').items.length,0)
})
test('scoped query-based child links retain parameters and never become pagination',()=>{
 const html=primary()+`<nav class="subnav" aria-label="榜单范围"><a href="/charts/?range=day">今日</a><a href="/charts/?range=week" aria-current="page">本周</a></nav><nav class="pagination"><a href="?range=week&page=2">2</a><a href="?range=week&page=2">下一页</a></nav>`+poster(1)
 const p=page(html,'/charts/?range=week')
 assert.deepEqual(p.navigation?.groups[0]?.links.map(link=>link.url),['https://catalog.example/charts/?range=day','https://catalog.example/charts/?range=week'])
 assert.equal(p.navigation?.groups.length,1)
})
test('refresh replaces observed primary entries and does not resurrect stale menu links',async()=>{
 const stale=page(primary()+poster(1))
 stale.profile.categories.push({title:'obsolete page',url:'https://catalog.example/obsolete'})
 let first=true
 const session=new CatalogSession(source,async request=>{if(first){first=false;return stale}return parseCatalogPage(source,request,primary('films')+poster(2))})
 await session.open({method:'GET',url:source.url})
 await session.open({method:'GET',url:'https://catalog.example/films/'})
 assert.equal(session.snapshot.page?.profile.categories.some(link=>link.title==='obsolete page'),false)
 session.cancel()
})
test('changing sections drops child navigation and failed requests retain last good context',async()=>{
 const session=new CatalogSession(source,async request=>{
  if(request.url.endsWith('/broken/'))throw new Error('test failure')
  return parseCatalogPage(source,request,request.url.includes('/charts/')?primary()+sub()+poster(1):primary('films')+poster(2))
 })
 await session.open({method:'GET',url:'https://catalog.example/charts/'})
 assert.equal(session.snapshot.page?.navigation?.groups.length,1)
 await session.open({method:'GET',url:'https://catalog.example/broken/'})
 assert.equal(session.snapshot.page?.navigation?.groups.length,1)
 await session.open({method:'GET',url:'https://catalog.example/films/'})
 assert.equal(session.snapshot.page?.navigation?.groups.length,0)
 session.cancel()
})

test('active query child identifies its primary owner without a path-prefix or active parent',()=>{
 const p=page('<nav><ul><li><a href="/chart.php">Charts</a><ul><li class="active"><a href="/chart.php?scope=film">Films</a></li><li><a href="/chart.php?scope=tv">Series</a></li></ul></li></ul></nav>','/chart.php?scope=film')
 assert.equal(p.navigation?.activePrimaryUrl,'https://catalog.example/chart.php')
 assert.equal(p.navigation?.groups[0]?.links.length,2)
 assert.equal(p.kind,'navigation')
})
test('third-level children cannot replace the parent of a second-level submenu',()=>{
 const html='<nav><ul><li class="active"><a href="/charts/">Charts</a><ul class="sub-menu"><li><a href="/charts/films/">Films</a><ul><li><a href="/charts/films/day/">Daily</a></li><li><a href="/charts/films/week/">Weekly</a></li></ul></li><li><a href="/charts/series/">Series</a></li></ul></li></ul></nav>'
 const root=page(html)
 assert.equal(root.kind,'navigation')
 assert.deepEqual(root.navigation?.groups.map(group=>group.links.map(link=>link.title)),[['Films','Series']])
 const nested=page(html,'/charts/films/week/')
 assert.deepEqual(nested.navigation?.groups.map(group=>group.links.map(link=>link.title)),[['Films','Series'],['Daily','Weekly']])
 assert.equal(nested.navigation?.groups[1]?.activeUrl,'https://catalog.example/charts/films/week/')
})
test('paired author metadata is not promoted into a single-item content catalogue',()=>{
 const html='<main><div class="byline"><a href="/authors/editor"><img src="/avatar.jpg"></a><h3><a href="/authors/editor">Editor Profile</a></h3></div></main>'
 assert.equal(page(html).articles.length,0)
 assert.equal(page(html).kind,'unsupported')
 assert.equal(page('<main>'+poster(1)+'</main>').articles.length,1,'legitimate singleton poster card still works')
})
