import assert from 'node:assert/strict'
import React, {act, useState} from 'react'
import {parseHTML} from 'linkedom'
import {
  loadBookmarkLibrary, saveBookmarkLibrary, type BrowserBookmarkLibrary,
} from '../src/features/browser/browserBookmarkLibrary'
import type { BookmarkScope } from '../src/features/browser/browserBookmarks'
import { BROWSER_KEYS } from '../src/features/browser/browserPreferences'

const {window}=parseHTML('<html><body><div id="root"></div></body></html>')
Object.assign(globalThis, {window, document:window.document, Node:window.Node, Element:window.Element,
  HTMLElement:window.HTMLElement, MutationObserver:window.MutationObserver,
  React, IS_REACT_ACT_ENVIRONMENT:true})
Object.defineProperty(window.document,'oninput',{configurable:true,value:null})
const typeDesc=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'type')!
Object.defineProperty(window.HTMLInputElement.prototype,'type',{configurable:true,
  get(){return typeDesc.get!.call(this)||'text'},set(value:string){typeDesc.set!.call(this,value)}})
Object.defineProperty(window,'matchMedia',{value:()=>({matches:false,addEventListener(){},removeEventListener(){}})})
Object.defineProperty(globalThis,'getComputedStyle',{value:()=>({visibility:'visible'})})
const storage=new Map<string,string>()
let failKey:string|null=null
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
  getItem:(key:string)=>storage.get(key)??null,
  setItem:(key:string,value:string)=>{if(key===failKey) throw new Error('storage unavailable');storage.set(key,String(value))},
}})
const {createRoot}=await import('react-dom/client')
const {BrowserBookmarkManager}=await import('../src/features/browser/BrowserBookmarkManager')
const root=createRoot(window.document.getElementById('root')!)
const old=[
  {url:'https://example.com/news',title:'新闻',time:1000},
  {url:'https://example.com/blog',title:'技术博客',time:1100},
]
storage.set(BROWSER_KEYS.bookmarks,JSON.stringify(old))
storage.set(BROWSER_KEYS.privateBookmarks,JSON.stringify([{url:'https://secret.example/hidden',title:'私密',time:1200}]))
const opened:string[]=[]
let backHandler=()=>false
let nextConfirm: {title:string;message:string;confirm:()=>boolean}|null=null
function Harness({privateMode=false}:{privateMode?:boolean}){
  const [normal,setNormal]=useState(()=>loadBookmarkLibrary('normal'))
  const [priv,setPriv]=useState(()=>loadBookmarkLibrary('private'))
  const [confirm,setConfirm]=useState<{title:string;message:string;confirm:()=>boolean}|null>(null)
  const onChange=(scope:BookmarkScope,next:BrowserBookmarkLibrary)=>{
    try{
      const saved=saveBookmarkLibrary(scope,next)
      if(scope==='normal') setNormal(saved)
      else setPriv(saved)
      return true
    }catch{return false}
  }
  return <><BrowserBookmarkManager normal={normal} privateLibrary={priv} privateMode={privateMode}
    onBack={()=>{}} onOpen={url=>opened.push(url)} onChange={onChange}
    onClear={scope=>setConfirm({title:'清空',message:'确认清空',confirm:()=>onChange(scope,{...(scope==='normal'?normal:priv),bookmarks:[]})})}
    onConfirm={value=>{nextConfirm=value;setConfirm(value)}}
    onRegisterBack={handler=>{backHandler=handler}}/>
    {confirm && <div aria-label="确认操作"><span>{confirm.title}：{confirm.message}</span>
      <button type="button" onClick={()=>{if(confirm.confirm()) setConfirm(null)}}>确认删除</button>
      <button type="button" onClick={()=>setConfirm(null)}>取消</button>
    </div>}</>
}
const render=async (privateMode=false) => act(async()=>root.render(<Harness key={privateMode?'private':'normal'} privateMode={privateMode}/>))
const button=(label:string):HTMLButtonElement=>{
  const found=[...window.document.querySelectorAll('button')].find(item=>item.getAttribute('aria-label')===label||item.textContent?.trim()===label)
  assert.ok(found,'Missing '+label)
  return found as HTMLButtonElement
}
const click=async(control:Element)=>act(async()=>{control.dispatchEvent(new window.Event('click',{bubbles:true,cancelable:true}))})
const type=async(label:string,value:string)=>{
  const element=window.document.querySelector('input[aria-label="'+label+'"]') as HTMLInputElement|null
  assert.ok(element,'Missing input '+label)
  const setter=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value')?.set
  await act(async()=>{
    if(setter)setter.call(element,value);else element.value=value
    element.dispatchEvent(new window.Event('input',{bubbles:true,cancelable:true}))
    element.dispatchEvent(new window.Event('change',{bubbles:true,cancelable:true}))
  })
}
const submit=async()=>{
  const form=window.document.querySelector('.browser-bookmark-form')!
  assert.ok(form,'missing bookmark form')
  await act(async()=>form.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})))
}
const present=(value:string)=>window.document.body.textContent?.includes(value)??false
await render()
assert.ok(button('打开：新闻'))
assert.equal(window.document.querySelector('section[aria-label="书签"] h2 button'),null,'public has no private title gesture')
await click(button('新建文件夹'))
await type('文件夹名称','技术')
await submit()
assert.ok(button('打开文件夹：技术'))
assert.equal(loadBookmarkLibrary('normal').folders.length,1)
await click(button('新建文件夹'))
await type('文件夹名称','技术')
await submit()
assert.ok(present('同一目录下已存在同名文件夹'),'duplicate folder errors appear in the dialog')
await click(button('关闭新建文件夹'))
await click(button('多选'))
await click(button('全选当前列表'))
assert.ok(present('已选 2 项'))
await click(button('移动'))
await click(button('移动到：技术'))
assert.equal(loadBookmarkLibrary('normal').bookmarks.filter(item=>item.folderId!==null).length,2,'bulk move committed')
assert.equal(opened.length,0,'select/move never opens a bookmark')
await click(button('打开文件夹：技术'))
assert.ok(button('打开：新闻'),'moved bookmarks are visible in the folder')
await click(button('更多操作：新闻'))
await click(button('编辑名称和网址'))
await type('书签名称','科技新闻')
await type('书签网址','https://example.com/technology')
await submit()
assert.ok(button('打开：科技新闻'))
assert.ok(loadBookmarkLibrary('normal').bookmarks.some(item=>item.url==='https://example.com/technology'))
await click(button('新建文件夹'))
await type('文件夹名称','前端')
await submit()
await click(button('更多操作：科技新闻'))
await click(button('移动到文件夹'))
await click(button('移动到：前端'))
assert.equal(loadBookmarkLibrary('normal').bookmarks.find(item=>item.title==='科技新闻')?.folderId,
  loadBookmarkLibrary('normal').folders.find(item=>item.name==='前端')?.id)
await click(button('打开文件夹：前端'))
await click(button('打开：科技新闻'))
assert.deepEqual(opened,['https://example.com/technology'])
await act(async()=>assert.equal(backHandler(),true,'hardware back navigates to the parent folder'))
assert.ok(button('打开文件夹：前端'))
await click(button('全部书签'))
await click(button('管理文件夹：技术'))
await click(button('重命名文件夹'))
await type('文件夹名称','开发收藏')
await submit()
assert.ok(button('打开文件夹：开发收藏'))
await click(button('新建文件夹'))
await act(async()=>assert.equal(backHandler(),true,'hardware back dismisses the editor before closing bookmarks'))
assert.ok(!window.document.querySelector('input[aria-label="文件夹名称"]'))
await click(button('新建文件夹'))
failKey=BROWSER_KEYS.bookmarkLibrary
await type('文件夹名称','无法保存')
await submit()
assert.ok(present('保存失败'),'save failure stays visible')
assert.equal(loadBookmarkLibrary('normal').folders.length,2,'failed save leaves persistent state unchanged')
failKey=null
await submit()
assert.ok(button('打开文件夹：无法保存'))
await type('搜索书签','科技新闻')
assert.ok(button('打开：科技新闻'),'search covers nested folder bookmarks')
await type('搜索书签','不存在')
assert.ok(present('没有找到相关书签'))
await type('搜索书签','')
await click(button('管理文件夹：开发收藏'))
await click(button('删除'))
assert.ok(nextConfirm?.message.includes('2 个书签'),'folder delete confirmation counts descendants')
await click(button('确认删除'))
assert.equal(loadBookmarkLibrary('normal').folders.some(item=>item.name==='开发收藏'),false)
assert.equal(loadBookmarkLibrary('normal').bookmarks.length,0,'recursive delete removes nested items')
assert.ok(button('打开文件夹：无法保存'),'unrelated folder survives deletion')
await act(async()=>root.render(null))
await render(true)
assert.ok(!window.document.documentElement.outerHTML.includes('secret.example'),'secret bookmark absent before unlock')
for(let i=0;i<4;i++)await click(window.document.querySelector('section[aria-label="书签"] h2 button')!)
assert.ok(!window.document.documentElement.outerHTML.includes('secret.example'))
await click(window.document.querySelector('section[aria-label="书签"] h2 button')!)
assert.ok(button('打开：私密'))
await click(button('删除：私密'))
assert.equal(loadBookmarkLibrary('private').bookmarks.length,0)
assert.equal(loadBookmarkLibrary('normal').bookmarks.length,0)
await act(async()=>root.render(null))
console.log('Browser bookmark manager UI: folder CRUD, nested browse, batch move, edit URL, search, confirmation, reload, private gate and failures passed')
