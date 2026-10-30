import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'
import type { NewsSource } from '../src/sources/registry'
import type { Article } from '../src/lib/types'

const { window } = parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true })
const { createRoot } = await import('react-dom/client')
const { SiteScreen } = await import('../src/screens/SiteScreen')
const source: NewsSource = {id:'nav_ui',name:'Catalog',label:'Catalog',group:'custom',kind:'web-catalog',enabled:true,url:'https://catalog.example/'}
const primary = (active:string) => `<header><nav><ul><li class="${active==='films'?'active':''}"><a href="/films/">电影</a></li><li class="${active==='charts'?'active':''}"><a href="/charts/">榜单</a></li></ul></nav></header>`
const sub = (active:string) => `<div class="box-title-nav"><a class="${active==='all'?'active':''}" href="/charts/">全部榜单</a><a class="${active==='film'?'active':''}" href="/charts/film.html">电影榜单</a><a class="${active==='tv'?'active':''}" href="/charts/tv.html">电视剧榜单</a></div>`
const item=(title:string,id:number)=>`<main><article><h2><a href="/posts/${id}">${title}</a></h2></article></main>`
const root=createRoot(document.getElementById('root')!)
const originalFetch=globalThis.fetch
let fail=false
let opened:Article|undefined
const requests:string[]=[]
function button(text:string,within:Element|Document=document):HTMLButtonElement {
 const found=[...within.querySelectorAll('button')].find(node=>node.textContent?.trim()===text)
 assert.ok(found,`Missing button: ${text}`)
 return found as HTMLButtonElement
}
async function click(text:string){await act(async()=>button(text).click())}
try {
 globalThis.fetch=async input=>{
  const url=new URL(String(input),'https://app.example').searchParams.get('url')!
  requests.push(url)
  if(fail)return new Response('failure',{status:503})
  const path=new URL(url).pathname
  let html=primary('films')+item('普通内容',1)
  if(path==='/charts/')html=primary('charts')+sub('all')
  if(path==='/charts/film.html')html=primary('charts')+sub('film')+item('电影榜单内容',2)+'<a rel="next" href="/charts/film.html?page=2">下一页</a>'
  if(path==='/charts/tv.html')html=primary('charts')+sub('tv')+item('电视剧榜单内容',3)
  return new Response(html,{headers:{'content-type':'text/html'}})
 }
 await act(async()=>root.render(<SiteScreen sites={[{source}]} readIds={new Set()} onOpen={article=>{opened=article}} />))
 await click('榜单')
 assert.equal(document.querySelector('[role="alert"]'),null,'navigation landing is successful')
 assert.ok(document.body.textContent?.includes('请选择子栏目'))
 const primaryNav=document.querySelector('nav[aria-label="全站导航"]')
 assert.ok(primaryNav)
 const childNav=document.querySelector('nav[aria-label="榜单子栏目"]')
 assert.ok(childNav,'subnavigation must have its own row')
 assert.equal(button('榜单',primaryNav).getAttribute('aria-current'),'page')
 assert.equal(button('全部榜单',childNav).getAttribute('aria-current'),'page')
 assert.equal(primaryNav.textContent?.includes('电视剧榜单'),false)
 await click('电影榜单')
 assert.ok(document.body.textContent?.includes('电影榜单内容'))
 assert.equal(button('榜单').getAttribute('aria-current'),'page')
 assert.equal(button('电影榜单').getAttribute('aria-current'),'page')
 const articleButton=[...document.querySelectorAll('button')].find(b=>b.textContent?.includes('电影榜单内容'))
 assert.ok(articleButton)
 await act(async()=>articleButton.click())
 assert.equal(opened?.sourceId,source.id)
 fail=true
 await click('电视剧榜单')
 assert.ok(document.querySelector('[role="alert"]'))
 assert.ok(document.body.textContent?.includes('电影榜单内容'),'failed request preserves last rendered list')
 assert.equal(button('电影榜单').getAttribute('aria-current'),'page','failed destination must not relabel the old list')
 fail=false
 await click('重试')
 assert.ok(document.body.textContent?.includes('电视剧榜单内容'))
 assert.equal(button('电视剧榜单').getAttribute('aria-current'),'page')
 await click('电影')
 assert.equal(document.querySelector('nav[aria-label="榜单子栏目"]'),null,'child context must not leak to a different primary section')
 assert.ok(document.body.textContent?.includes('普通内容'))
 assert.equal(button('电影').getAttribute('aria-current'),'page')
 assert.equal(requests.filter(url=>url.endsWith('/charts/tv.html')).length,2,'retry uses the failed child URL')
}finally {await act(async()=>root.unmount());globalThis.fetch=originalFetch}
console.log('site navigation UI: parent/child selection, navigation landing, articles, failure/retry and section isolation passed')
