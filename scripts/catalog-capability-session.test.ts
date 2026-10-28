import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CatalogSession } from '../src/features/siteCatalog/session'
import { parseCatalogPage } from '../src/features/siteCatalog/service'
import type { NewsSource } from '../src/sources/registry'
import type { CatalogRequest } from '../src/features/siteCatalog/types'

const source: NewsSource={id:'post-session',name:'Catalog',label:'Catalog',url:'https://catalog.example/filter',kind:'web-catalog',group:'custom',enabled:true}
const pageField=(request:CatalogRequest)=>Number(request.fields?.find(item=>item.name==='page')?.value||1)
const request=(page:number):CatalogRequest=>({url:source.url,method:'POST',fields:[{name:'year',value:'2025'},{name:'page',value:String(page)}]})
const html=(page:number,next=page+1)=>`<main><article><h2><a href="/posts/${page}">Article ${page}</a></h2></article></main><form class="pager" method="post" action="/filter"><input type="hidden" name="year" value="2025"><button type="submit" name="page" value="${next}">下一页</button></form>`

test('observed next-page POST preserves payload and same-URL pages have independent identities',async()=>{
 const seen:CatalogRequest[]=[]
 const session=new CatalogSession(source,async req=>{seen.push(req);return parseCatalogPage(source,req,html(pageField(req)))})
 await session.open(request(1));await session.next();await session.next()
 assert.equal(seen.length,3)
 assert.deepEqual(seen.map(pageField),[1,2,3])
 assert.ok(seen.every(req=>req.method==='POST'&&req.fields?.some(item=>item.name==='year'&&item.value==='2025')))
 assert.equal(session.snapshot.page?.articles[0].title,'Article 3')
 session.previous();assert.equal(session.snapshot.page?.articles[0].title,'Article 2')
 await session.next();assert.equal(seen.length,3,'forward history must not re-fetch')
 session.cancel()
})

test('exact repeated POST terminates pagination rather than looping',async()=>{
 const session=new CatalogSession(source,async req=>parseCatalogPage(source,req,html(pageField(req),2)))
 await session.open(request(1));await session.next();await session.next()
 assert.equal(session.snapshot.history.length,2)
 assert.equal(session.snapshot.exhausted,true)
 session.cancel()
})

test('a failed POST next page retains its method and payload for retry',async()=>{
 let fail=true
 const session=new CatalogSession(source,async req=>{if(pageField(req)===2&&fail)throw new Error('temporary');return parseCatalogPage(source,req,html(pageField(req)))})
 await session.open(request(1));await session.next()
 assert.equal(session.snapshot.page?.articles[0].title,'Article 1')
 assert.equal(session.snapshot.error,'temporary')
 fail=false;await session.retry()
 assert.equal(session.snapshot.page?.articles[0].title,'Article 2')
 assert.equal(session.snapshot.history.length,2)
 session.cancel()
})

test('refresh after previous replaces the current entry without appending duplicate history',async()=>{
 const session=new CatalogSession(source,async req=>parseCatalogPage(source,req,html(pageField(req))))
 await session.open(request(1));await session.next();session.previous();await session.retry()
 assert.equal(session.snapshot.index,0)
 assert.equal(session.snapshot.page?.articles[0].title,'Article 1')
 assert.equal(session.snapshot.history.filter(page=>page.articles[0].title==='Article 1').length,1)
 session.cancel()
})

test('late POST results cannot overwrite a newer filter selection',async()=>{
 let release:()=>void=()=>{}
 const session=new CatalogSession(source,async req=>{if(pageField(req)===1)await new Promise<void>(resolve=>{release=resolve});return parseCatalogPage(source,req,html(pageField(req)))})
 const slow=session.open(request(1));await session.open(request(2));release();await slow
 assert.equal(session.snapshot.page?.articles[0].title,'Article 2')
 session.cancel()
})
