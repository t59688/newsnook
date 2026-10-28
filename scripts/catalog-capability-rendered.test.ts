import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadCatalogPage } from '../src/features/siteCatalog/service'
import type { NewsSource } from '../src/sources/registry'
const source:NewsSource={id:'rendered',name:'Rendered',label:'Rendered',url:'https://catalog.example/',kind:'web-catalog',group:'custom',enabled:true}
const shell='<html><head><title>Catalog</title></head><body><div id="app"></div><script src="/app.js"></script></body></html>'
const document='<main><div><strong>年份</strong><a href="?year=2025">2025</a><a href="?year=2026">2026</a></div><article><h2><a href="/posts/one">Rendered result</a></h2></article></main>'
const originalFetch=globalThis.fetch

test('interactive dynamic shell snapshot feeds the same catalog and ability inference',async()=>{
 let calls=0
 globalThis.fetch=async()=>new Response(shell,{headers:{'content-type':'text/html'}})
 try{
  const page=await loadCatalogPage(source,{url:source.url,method:'GET'},undefined,{allowRendered:true,renderer:async input=>{calls++;assert.equal(input.url,source.url);assert.ok(input.userAgent);return {html:document,url:source.url}}})
  assert.equal(calls,1);assert.equal(page.articles[0].title,'Rendered result');assert.equal(page.capabilities?.source,'rendered');assert.equal(page.capabilities?.controls[0].semantic,'year')
 }finally{globalThis.fetch=originalFetch}
})

test('background/static loads do not start a rendered browser even when a renderer is available',async()=>{
 let calls=0;globalThis.fetch=async()=>new Response(shell)
 try{await assert.rejects(loadCatalogPage(source,{url:source.url,method:'GET'},undefined,{renderer:async()=>{calls++;return {html:document,url:source.url}}}));assert.equal(calls,0)}finally{globalThis.fetch=originalFetch}
})

test('working static catalogs never trigger dynamic work',async()=>{
 let calls=0;globalThis.fetch=async()=>new Response(document)
 try{const page=await loadCatalogPage(source,{url:source.url,method:'GET'},undefined,{allowRendered:true,renderer:async()=>{calls++;return {html:document,url:source.url}}});assert.equal(calls,0);assert.equal(page.capabilities?.source,'html')}finally{globalThis.fetch=originalFetch}
})

test('HTTP failure or challenge pages never trigger a silent render-and-retry loop',async()=>{
 for(const response of [()=>new Response('failed',{status:403}),()=>new Response('<html><title>Just a moment...</title><body><div id="challenge-form"></div><script src="/challenge.js"></script></body></html>')]){
  let calls=0;globalThis.fetch=async()=>response()
  try{await assert.rejects(loadCatalogPage(source,{url:source.url,method:'GET'},undefined,{allowRendered:true,renderer:async()=>{calls++;return {html:document,url:source.url}}}));assert.equal(calls,0)}finally{globalThis.fetch=originalFetch}
 }
})

test('a POST response is not silently replayed as GET in a rendered browser',async()=>{
 let calls=0;globalThis.fetch=async()=>new Response(shell)
 try{await assert.rejects(loadCatalogPage(source,{url:source.url,method:'POST',fields:[{name:'year',value:'2026'}]},undefined,{allowRendered:true,renderer:async()=>{calls++;return {html:document,url:source.url}}}));assert.equal(calls,0)}finally{globalThis.fetch=originalFetch}
})

test('cancelled render cannot return a successful page from a late snapshot',async()=>{
 const controller=new AbortController();let release:()=>void=()=>{};let started:()=>void=()=>{};const ready=new Promise<void>(resolve=>{started=resolve})
 globalThis.fetch=async()=>new Response(shell)
 try{
  const operation=loadCatalogPage(source,{url:source.url,method:'GET'},controller.signal,{allowRendered:true,renderer:async input=>{started();await new Promise<void>(resolve=>{release=resolve});assert.equal(input.signal?.aborted,true);return {html:document,url:source.url}}})
  const rejected=assert.rejects(operation);await ready;controller.abort();release();await rejected
 }finally{globalThis.fetch=originalFetch}
})

test('a snapshot cannot move parsing to an unrelated origin or exceed the HTML budget',async()=>{
 globalThis.fetch=async()=>new Response(shell)
 try{for(const snapshot of [{url:'https://elsewhere.example/',html:document},{url:source.url,html:'x'.repeat(2*1024*1024+1)}]){
  await assert.rejects(loadCatalogPage(source,{url:source.url,method:'GET'},undefined,{allowRendered:true,renderer:async()=>snapshot}))
 }}finally{globalThis.fetch=originalFetch}
})
