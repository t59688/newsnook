import assert from 'node:assert/strict'
import {
  addBookmark, bookmarkFolderDescendants, bookmarkFolderOptions, bookmarkFolderPath, createBookmarkFolder,
  deleteBookmarkFolder, deleteBookmarks, editBookmark, hasBookmarkLibrary, loadBookmarkLibrary,
  moveBookmarkFolder, moveBookmarks, normalizeBookmarkLibrary, renameBookmarkFolder,
  saveBookmarkLibrary, bookmarkLibraryKey,
} from '../src/features/browser/browserBookmarkLibrary'
import { loadBrowserBookmarks, saveBrowserBookmarks, toggleBrowserBookmark } from '../src/features/browser/browserBookmarks'
import { BROWSER_KEYS } from '../src/features/browser/browserPreferences'

const storage = new Map<string,string>()
let failKey: string|null = null
Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
  getItem:(key:string)=>storage.get(key)??null,
  setItem:(key:string,value:string)=>{
    if (key===failKey) throw new Error('storage full')
    storage.set(key,String(value))
  },
}})
const oldNormal = [{url:'https://news.example/',title:'新闻',time:1000},
  {url:'https://books.example/',title:'书籍',time:2000}]
const oldPrivate = [{url:'https://secret.example/',title:'私人',time:3000}]
storage.set(BROWSER_KEYS.bookmarks,JSON.stringify(oldNormal))
storage.set(BROWSER_KEYS.privateBookmarks,JSON.stringify(oldPrivate))
assert.equal(hasBookmarkLibrary('normal'),false)
let catalog = loadBookmarkLibrary('normal')
assert.deepEqual(catalog.bookmarks.map(item=>item.folderId),[null,null])
assert.equal(catalog.bookmarks.length,2)
assert.equal(loadBookmarkLibrary('private').bookmarks.length,1)
catalog = createBookmarkFolder(catalog,'技术',null,'f_tech',4000)
catalog = createBookmarkFolder(catalog,'前端','f_tech','f_front',4100)
catalog = createBookmarkFolder(catalog,'阅读',null,'f_read',4200)
assert.equal(catalog.folders.length,3)
assert.throws(()=>createBookmarkFolder(catalog,'技术',null,'f_dup'),/同名/)
assert.throws(()=>createBookmarkFolder(catalog,'','f_tech','f_empty'),/名称/)
assert.throws(()=>createBookmarkFolder(catalog,'未找到','f_missing','f_bad'),/不存在/)
assert.deepEqual([...bookmarkFolderDescendants(catalog,'f_tech')].sort(),['f_front','f_tech'])
assert.deepEqual(bookmarkFolderPath(catalog,'f_front').map(item=>item.name),['技术','前端'])
assert.deepEqual(bookmarkFolderOptions(catalog).map(item=>item.label),['根目录','技术','前端','阅读'])
assert.deepEqual(bookmarkFolderOptions(catalog,'f_tech').map(item=>item.label),['根目录','阅读'])
catalog = moveBookmarks(catalog,['https://news.example/'],'f_front')
assert.equal(catalog.bookmarks.find(item=>item.url==='https://news.example/')?.folderId,'f_front')
assert.equal(catalog.bookmarks.find(item=>item.url==='https://books.example/')?.folderId,null)
assert.throws(()=>moveBookmarkFolder(catalog,'f_tech','f_front'),/自身/)
assert.throws(()=>moveBookmarkFolder(catalog,'f_front','f_front'),/自身/)
catalog = renameBookmarkFolder(catalog,'f_tech','开发')
assert.equal(catalog.folders.find(item=>item.id==='f_tech')?.name,'开发')
catalog = moveBookmarkFolder(catalog,'f_read','f_tech')
assert.equal(catalog.folders.find(item=>item.id==='f_read')?.parentId,'f_tech')
catalog = addBookmark(catalog,'媒体','https://media.example/','f_read',5000)
assert.equal(catalog.bookmarks.length,3)
assert.throws(()=>addBookmark(catalog,'重复','https://media.example/','f_read'),/已存在/)
assert.throws(()=>addBookmark(catalog,'危险','javascript:alert(1)',null),/HTTP/)
assert.throws(()=>editBookmark(catalog,'https://media.example/','','https://media.example/'),/名称/)
assert.throws(()=>editBookmark(catalog,'https://media.example/','重复','https://news.example/'),/已存在/)
catalog = editBookmark(catalog,'https://media.example/','新的名字','https://media.example/v2')
assert.equal(catalog.bookmarks.find(item=>item.url==='https://media.example/v2')?.title,'新的名字')
assert.equal(catalog.bookmarks.find(item=>item.url==='https://media.example/v2')?.folderId,'f_read')
const beforeWrite=storage.get(BROWSER_KEYS.bookmarks)
const stored=saveBookmarkLibrary('normal',catalog)
assert.equal(storage.get(BROWSER_KEYS.bookmarks),beforeWrite,'V2 snapshot must not overwrite the legacy backup')
assert.deepEqual(loadBookmarkLibrary('normal'),stored,'all folder links persist in one snapshot')
assert.equal(loadBookmarkLibrary('private').bookmarks.length,1,'normal writes never change private store')
assert.ok(!storage.get(bookmarkLibraryKey('private')),'private V2 is absent until separately edited')
assert.equal(loadBrowserBookmarks('normal').length,3,'flat legacy read APIs support V2 bookmarks')
const toggled=toggleBrowserBookmark(loadBrowserBookmarks('normal'),'https://extra.example/','额外')
saveBrowserBookmarks('normal',toggled.entries)
assert.equal(loadBookmarkLibrary('normal').bookmarks.length,4)
assert.equal(loadBookmarkLibrary('normal').bookmarks.find(item=>item.url==='https://news.example/')?.folderId,'f_front',
  'old browser toggle must preserve managed bookmark folder')
const removed=toggleBrowserBookmark(loadBrowserBookmarks('normal'),'https://news.example/','新闻')
saveBrowserBookmarks('normal',removed.entries)
assert.ok(!loadBookmarkLibrary('normal').bookmarks.some(item=>item.url==='https://news.example/'))
assert.ok(loadBookmarkLibrary('normal').folders.some(item=>item.id==='f_front'),
  'removing a bookmark does not delete its folder')
const toDelete=deleteBookmarkFolder(loadBookmarkLibrary('normal'),'f_tech')
assert.equal(toDelete.folders.length,0,'parent deletion recursively removes children')
assert.ok(!toDelete.bookmarks.some(item=>item.url==='https://media.example/v2'),
  'folder deletion removes descendant bookmarks')
assert.ok(toDelete.bookmarks.some(item=>item.url==='https://books.example/'),
  'folder deletion keeps unrelated root bookmarks')
assert.equal(deleteBookmarks(toDelete,['https://books.example/']).bookmarks.length,toDelete.bookmarks.length-1)
const unchanged=storage.get(bookmarkLibraryKey('normal'))
failKey=bookmarkLibraryKey('normal')
assert.throws(()=>saveBookmarkLibrary('normal',toDelete),/保存失败/)
assert.equal(storage.get(bookmarkLibraryKey('normal')),unchanged,'failed V2 write preserves persisted library')
failKey=null
assert.deepEqual(loadBookmarkLibrary('normal'),loadBookmarkLibrary('normal'),'failed save leaves view consistent')
const privateCatalog=createBookmarkFolder(loadBookmarkLibrary('private'),'私密目录',null,'f_secret')
saveBookmarkLibrary('private',privateCatalog)
assert.equal(loadBookmarkLibrary('private').bookmarks[0].title,'私人')
assert.equal(loadBookmarkLibrary('normal').folders.some(folder=>folder.id==='f_secret'),false)
storage.set(bookmarkLibraryKey('normal'),'{ invalid json')
assert.equal(loadBookmarkLibrary('normal').bookmarks.length,2,'malformed V2 recovers the intact V1 backup')
assert.equal(loadBookmarkLibrary('private').folders.length,1,'private V2 stays isolated')
const corrupt=normalizeBookmarkLibrary({version:2,folders:[
  {id:'f_a',name:'A',parentId:'f_b'}, {id:'f_b',name:'B',parentId:'f_a'},
  {id:'f_missing',name:'Lost',parentId:'f_unknown'}, {id:'bad id',name:'bad',parentId:null},
],bookmarks:[{url:'https://some.example/',title:'Some',time:100,folderId:'unknown'}]})
assert.ok(corrupt.folders.some(item=>item.parentId===null),'cyclic trees become reachable')
assert.ok(corrupt.folders.every(item=>item.parentId===null || corrupt.folders.some(parent=>parent.id===item.parentId)))
assert.equal(corrupt.bookmarks[0].folderId,null,'orphan bookmarks are recovered into root')
assert.equal(corrupt.folders.length,3)
console.log('Browser bookmark V1 migration, nested folders, rename, move, bulk, delete, isolation, rollback and corruption recovery passed')
