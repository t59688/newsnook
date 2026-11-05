import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCatalogPage } from '../src/features/siteCatalog/service'
import { extractCatalog } from '../src/features/catalogEngine/engine'
import { migrateCatalogCache } from '../src/features/siteCatalog/cache'
import { isLikelyVideoArticle } from '../src/features/siteCatalog/uiUtils'
import type { NewsSource } from '../src/sources/registry'
const source:NewsSource={id:'mixed',name:'Mixed',label:'Mixed',url:'https://catalog.example/',group:'custom',enabled:true,kind:'web-catalog',frameworkHint:{framework:'maccms',paginationPattern:{kind:'next-link'}}}
const parse=(html:string)=>parseCatalogPage(source,{url:source.url,method:'GET'},'<meta name="generator" content="MacCMS">'+html)

test('a video CMS identity alone cannot turn unknown or person entries into videos',()=>{
 const page=parse('<main><div class="card" itemtype="https://schema.org/Person"><h3><a href="/actor/alex">Alex Person</a></h3><img src="/alex.jpg"></div><div class="card"><h3><a href="/resource/unknown">Unknown Resource</a></h3></div><article><h2><a href="/posts/story">Story article</a></h2></article><div class="card"><h3><a href="/video/film">Actual film</a></h3></div></main>')
 assert.deepEqual(page.articles.map(item=>item.contentType),['article','article','article','video'])
 assert.equal(page.itemMetadata?.['https://catalog.example/actor/alex']?.entityType,'person')
 assert.equal(isLikelyVideoArticle(page.articles[0],true),false)
 const migrated=migrateCatalogCache(source,[{...page.articles[0],contentType:'video'}])
 assert.equal(migrated[0].contentType,'article','old person entries repair without deleting cache')
})

test('rank positions are metadata, never prefixed into titles or confused with quality',()=>{
 const html='<main><ol start="11">'+[11,12,13].map(rank=>`<li><a href="/data/item-${rank}.html"><em class="num">${rank}</em><span>Film ${rank}</span></a></li>`).join('')+'</ol></main>'
 const items=extractCatalog(html,source.url).items
 assert.deepEqual(items.map(item=>item.rank),[11,12,13])
 assert.deepEqual(items.map(item=>item.title),['Film 11','Film 12','Film 13'])
 const page=parse(html)
 assert.equal(page.itemMetadata?.['https://catalog.example/data/item-12.html']?.rank,12)
})

test('JSON-LD list position and per-entry entity type survive content mapping',()=>{
 const html='<script type="application/ld+json">'+JSON.stringify({'@type':'ItemList',itemListElement:[{'@type':'ListItem',position:2,item:{'@type':'VideoObject',name:'Film',url:'/video/a'}},{'@type':'ListItem',position:1,item:{'@type':'Person',name:'Author',url:'/actor/a'}}]})+'</script>'
 const page=parse(html)
 assert.deepEqual(page.articles.map(item=>item.contentType),['video','article'])
 assert.equal(page.itemMetadata?.['https://catalog.example/video/a']?.rank,2)
 assert.equal(page.itemMetadata?.['https://catalog.example/actor/a']?.entityType,'person')
})

test('a results collection wrapped by its filter form remains visible',()=>{
 const page=parse('<main><form action="/list"><label>年份<select name="year"><option>2025</option><option>2026</option></select></label><div class="card"><h3><a href="/video/one">One film</a></h3></div><div class="card"><h3><a href="/video/two">Two film</a></h3></div></form></main>')
 assert.equal(page.articles.length,2)
 assert.equal(page.capabilities?.controls.find(item=>item.semantic==='year')?.choices.length,2)
})

test('structured SearchAction is executed from its explicit template without guessed routes',async()=>{
 const {catalogSearchRequest}=await import('../src/features/siteCatalog/requests')
 const page=parse('<script type="application/ld+json">'+JSON.stringify({'@type':'WebSite',potentialAction:{'@type':'SearchAction',target:{'@type':'EntryPoint',urlTemplate:'https://catalog.example/find?term={search_term_string}&type=all'},'query-input':'required name=search_term_string'}})+'</script>')
 const request=catalogSearchRequest(page.capabilities!,'a&中文')
 assert.equal(new URL(request!.url).searchParams.get('term'),'a&中文')
 assert.equal(new URL(request!.url).searchParams.get('type'),'all')
})

test('a card inside an ordered-list row retains the containing row rank',()=>{
 const page=parse('<main><ol start="5">'+[1,2,3].map(i=>`<li><div class="card"><h2><a href="/video/${i}">Film ${i}</a></h2></div></li>`).join('')+'</ol></main>')
 assert.deepEqual(page.articles.map(item=>page.itemMetadata?.[item.originUrl]?.rank),[5,6,7])
})
