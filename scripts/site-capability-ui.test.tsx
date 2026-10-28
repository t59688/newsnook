import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import React, { act } from 'react'
import type { NewsSource } from '../src/sources/registry'
const { window }=parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis,{window,document:window.document,Node:window.Node,Element:window.Element,HTMLElement:window.HTMLElement,React,IS_REACT_ACT_ENVIRONMENT:true})
const {createRoot}=await import('react-dom/client')
const {SiteScreen}=await import('../src/screens/SiteScreen')
const source:NewsSource={id:'ability-ui',name:'Catalog',label:'Catalog',url:'https://catalog.example/browse',group:'custom',kind:'web-catalog',enabled:true}
const root=createRoot(document.getElementById('root')!)
const originalFetch=globalThis.fetch
const requests:{url:string;method:string;body:URLSearchParams}[]=[]
let fail=false
const option=(value:string,label:string,current:string)=>`<option value="${value}" ${value===current?'selected':''}>${label}</option>`
function html(year:string,area:string,order:string,query:string){return '<nav><a href="/browse">目录</a><a href="/plain">普通栏目</a></nav><form action="/browse" method="post" role="search"><input type="search" name="q" value="'+query+'"><label>年份<select name="year">'+option('2025','2025',year)+option('2026','2026',year)+'</select></label><label>地区<select name="area">'+option('CN','中国',area)+option('US','美国',area)+'</select></label><label>排序<select name="order">'+option('time','最新',order)+option('score','评分',order)+'</select></label><input name="type" type="hidden" value="film"></form><main><article><h2><a href="/posts/'+year+'-'+area+'-'+order+'">结果 '+year+' '+area+' '+order+' '+query+'</a></h2></article></main>'}
function button(text:string,scope:Document|Element=document):HTMLButtonElement{const b=[...scope.querySelectorAll('button')].find(node=>node.textContent?.trim()===text);assert.ok(b,'Missing button '+text);return b as HTMLButtonElement}
async function click(text:string){await act(async()=>button(text).click())}
function group(semantic:string):Element{const el=document.querySelector(`[data-catalog-control="${semantic}"]`);assert.ok(el,'Missing control '+semantic);return el}
try{
 globalThis.fetch=async(input,init)=>{
  const proxy=new URL(String(input),'https://app.example');const url=proxy.searchParams.get('url')!;const body=new URLSearchParams(String(init?.body||''));const method=init?.method||'GET';requests.push({url,method,body})
  if(fail)return new Response('temporary',{status:503})
  if(new URL(url).pathname==='/plain')return new Response('<nav><a href="/browse">目录</a><a href="/plain">普通栏目</a></nav><main><article><h2><a href="/posts/plain">普通文章</a></h2></article></main>',{headers:{'content-type':'text/html'}})
  const year=body.get('year')||'2025',area=body.get('area')||'CN',order=body.get('order')||'time',q=body.get('q')||''
  return new Response(html(year,area,order,q),{headers:{'content-type':'text/html'}})
 }
 await act(async()=>root.render(<SiteScreen sites={[{source}]} readIds={new Set()} onOpen={()=>{}}/>))
 const primary=document.querySelector('[aria-label="全站导航"]')!
 assert.deepEqual([...primary.querySelectorAll('button')].map(node=>node.textContent?.trim()),['目录','普通栏目'],'source entry appears once, using its observed label')
 assert.equal(primary.querySelectorAll('[aria-current="page"]').length,1)
 const disclosure=document.querySelector<HTMLButtonElement>('[aria-label="展开筛选与排序"]');assert.ok(disclosure,'all supported controls need a user-visible entry')
 await act(async()=>disclosure.click())
 assert.equal(button('2025',group('year')).getAttribute('aria-pressed'),'true')
 await click('2026')
 assert.equal(requests.at(-1)?.method,'POST')
 assert.equal(requests.at(-1)?.body.get('year'),'2026')
 assert.equal(requests.at(-1)?.body.get('area'),'CN')
 assert.equal(requests.at(-1)?.body.get('type'),'film')
 assert.ok(document.body.textContent?.includes('结果 2026 CN time'))
 assert.equal(button('2026',group('year')).getAttribute('aria-pressed'),'true')
 await click('美国')
 assert.equal(requests.at(-1)?.body.get('year'),'2026','region action must keep selected year')
 assert.equal(requests.at(-1)?.body.get('area'),'US')
 await click('评分')
 assert.equal(requests.at(-1)?.body.get('year'),'2026');assert.equal(requests.at(-1)?.body.get('area'),'US');assert.equal(requests.at(-1)?.body.get('order'),'score')
 fail=true;await click('2025')
 assert.ok(document.querySelector('[role="alert"]'))
 assert.equal(button('2026',group('year')).getAttribute('aria-pressed'),'true','failed action does not relabel old data')
 fail=false;await click('重试')
 assert.equal(button('2025',group('year')).getAttribute('aria-pressed'),'true')
 const searchButton=document.querySelector<HTMLButtonElement>('[aria-label="展开搜索"]');assert.ok(searchButton);await act(async()=>searchButton.click())
 const input=document.querySelector<HTMLInputElement>('[aria-label="站内搜索"]');assert.ok(input)
 const props=Object.keys(input).find(key=>key.startsWith('__reactProps$'));assert.ok(props)
 await act(async()=>{(input as unknown as Record<string,{onChange:(event:unknown)=>void}>)[props].onChange({target:{value:'中文 query'}})})
 // linkedom does not run the browser's submit-button default action. Dispatch
 // the actual submit event so React executes the production form handler.
 await act(async()=>{input.closest('form')!.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}))})
 assert.equal(requests.at(-1)?.body.get('q'),'中文 query')
 assert.equal(requests.at(-1)?.body.get('year'),'2025');assert.equal(requests.at(-1)?.body.get('area'),'US');assert.equal(requests.at(-1)?.body.get('order'),'score')
 await click('普通栏目')
 assert.equal(document.querySelector('[data-catalog-control]'),null,'previous page facets never leak into a new section')
 assert.equal(document.querySelector('[aria-label="展开筛选与排序"]'),null)
 assert.ok(document.body.textContent?.includes('普通文章'))
}finally{await act(async()=>root.unmount());globalThis.fetch=originalFetch}
console.log('CMS executable UI: POST filters, composition, sort, search, failed selection, retry, section isolation: PASS')
