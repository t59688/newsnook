import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {parseHTML} from 'linkedom'
import {test} from 'node:test'
import ts from 'typescript'
const java=readFileSync(new URL('../android/app/src/main/java/com/aizeek/newsnook/CatalogSnapshotScript.java',import.meta.url),'utf8')
const block=java.slice(java.indexOf('static final String PROBE ='))
const script=[...block.matchAll(/"(?:\\.|[^"\\])*"/g)].map(match=>JSON.parse(match[0])).join('')
function runtime(html){const {window}=parseHTML(html);Object.defineProperty(window,'location',{configurable:true,value:{href:'https://catalog.example/list'}});Object.defineProperty(window.document,'readyState',{configurable:true,value:'complete'});window.TextEncoder=TextEncoder;return {window,read:()=>JSON.parse(vm.runInNewContext(script,window))}}

test('the actual native snapshot script is ES2018-compatible and never submits or clicks',()=>{
 const source=ts.createSourceFile('snapshot.js',script,ts.ScriptTarget.ES2018,true,ts.ScriptKind.JS)
 assert.deepEqual(source.parseDiagnostics,[])
 assert.equal(script.includes('?.'),false)
 assert.equal(script.includes('=>'),false)
 assert.equal(/\.click\(|\.submit\(|\.play\(/.test(script),false)
})

test('global navigation alone cannot make an unfinished application shell ready',()=>{
 const {read}=runtime('<html><body><header><nav><a href="/films">Films</a><a href="/news">News</a></nav></header><div id="app">Loading...</div></body></html>')
 assert.equal(read().ready,false)
})

test('a loading placeholder is not content even when it already contains template links',()=>{
 const {read}=runtime('<html><body><main aria-busy="true"><a href="/item/1">Loading...</a><a href="/item/2">Loading...</a></main></body></html>')
 assert.equal(read().ready,false)
})

test('real rendered cards are accepted and live form selection is reflected in the snapshot',()=>{
 const {window,read}=runtime('<html><body><main><article><a href="/posts/one">One article</a></article><form><input name="q" value="old"><input type="checkbox" name="published"><input type="password" name="password" value="private"><select name="year"><option value="2025" selected>2025</option><option value="2026">2026</option></select></form></main></body></html>')
 const document=window.document
 document.querySelector('[name=q]').value='new'
 document.querySelector('[name=published]').checked=true
 const options=document.querySelectorAll('option');Object.defineProperty(options[0],'selected',{configurable:true,value:false});Object.defineProperty(options[1],'selected',{configurable:true,value:true})
 const snapshot=read();assert.equal(snapshot.ready,true)
 const cloned=parseHTML(snapshot.html).document
 assert.equal(cloned.querySelector('[name=q]').getAttribute('value'),'new')
 assert.equal(cloned.querySelector('[name=published]').hasAttribute('checked'),true)
 assert.equal(cloned.querySelector('option[value="2026"]').hasAttribute('selected'),true)
 assert.equal(cloned.querySelector('option[value="2025"]').hasAttribute('selected'),false)
 assert.equal(snapshot.html.includes('private'),false)
 assert.equal(snapshot.url,'https://catalog.example/list')
})

test('a rendered empty-result message can complete without fabricating items',()=>{
 const {read}=runtime('<html><body><main><p>No results found</p></main></body></html>')
 assert.equal(read().ready,true)
})

test('the snapshot returns a bounded too-large signal before transferring huge HTML',()=>{
 const {read}=runtime('<html><body><main><article><a href="/one">Title</a><p>'+ 'x'.repeat(2*1024*1024) +'</p></article></main></body></html>')
 const snapshot=read();assert.equal(snapshot.tooLarge,true);assert.equal(snapshot.html,undefined)
})

test('ordinary skeleton containers without aria-busy are not ready catalog items',()=>{
 for(const className of ['skeleton','skeleton-loader','loading-placeholder']){
  const {read}=runtime(`<html><body><main><div class="${className}"><div class="card"><a href="/item/1">Loading...</a></div><div class="card"><a href="/item/2">Loading...</a></div></div></main></body></html>`)
  assert.equal(read().ready,false,className)
 }
})

test('real content after skeletons and lazy loading poster classes still counts',()=>{
 const {read}=runtime('<html><body><main><div class="skeleton"><div class="card"><a href="/placeholder">Loading...</a></div></div><article><a class="video-pic loading" href="/item/real">Ready real item</a></article></main></body></html>')
 assert.equal(read().ready,true)
})
