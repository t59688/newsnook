/** Hierarchical bookmark catalog. V1 flat bookmarks remain readable; a single V2 snapshot
 * becomes authoritative after the first folder/manager edit. Normal and private never share keys.
 */
import { normalizeBrowserVisits, type BrowserVisit } from './browserHistory'
import { BROWSER_KEYS, readBrowserList, writeBrowserPreference } from './browserPreferences'
import type { BookmarkScope } from './browserBookmarks'

export interface BrowserBookmark extends BrowserVisit { folderId: string | null }
export interface BrowserBookmarkFolder { id: string; name: string; parentId: string | null; createdAt: number }
export interface BrowserBookmarkLibrary {
  version: 2
  bookmarks: BrowserBookmark[]
  folders: BrowserBookmarkFolder[]
}

export const bookmarkLibraryKey = (scope: BookmarkScope): string => scope === 'private'
  ? BROWSER_KEYS.privateBookmarkLibrary : BROWSER_KEYS.bookmarkLibrary

const oldKey = (scope: BookmarkScope) => scope === 'private' ? BROWSER_KEYS.privateBookmarks : BROWSER_KEYS.bookmarks
const cleanName = (name: string, max = 80) => name.trim().slice(0, max)
const validId = (id: unknown): id is string =>
  typeof id === 'string' && id.length > 0 && id.length <= 100 && /^[a-zA-Z0-9_-]+$/.test(id)

export function normalizeBookmarkLibrary(value: unknown): BrowserBookmarkLibrary {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  const folders: BrowserBookmarkFolder[] = []
  const seen = new Set<string>()
  if (Array.isArray(source.folders)) for (const raw of source.folders.slice(0, 1000)) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as Record<string, unknown>
    const name = typeof item.name === 'string' ? cleanName(item.name) : ''
    if (!validId(item.id) || seen.has(item.id) || !name) continue
    seen.add(item.id)
    folders.push({ id:item.id, name, parentId: validId(item.parentId) ? item.parentId : null,
      createdAt: typeof item.createdAt === 'number' && Number.isFinite(item.createdAt) && item.createdAt >= 0 ? item.createdAt : 0 })
  }
  const byId = new Map(folders.map(folder => [folder.id, folder]))
  // A damaged cyclic tree must not make any folder inaccessible or hang tree traversal.
  for (const folder of folders) {
    const chain = new Set([folder.id])
    let parentId = folder.parentId
    while (parentId) {
      if (chain.has(parentId) || !byId.has(parentId)) { folder.parentId = null; break }
      chain.add(parentId)
      parentId = byId.get(parentId)!.parentId
    }
  }
  const rawBookmarks = Array.isArray(source.bookmarks) ? source.bookmarks : []
  const folderByUrl = new Map<string, string | null>()
  for (const value of rawBookmarks) {
    if (!value || typeof value !== 'object') continue
    const item = value as Record<string, unknown>
    if (typeof item.url === 'string' && !folderByUrl.has(item.url)) {
      folderByUrl.set(item.url, validId(item.folderId) && byId.has(item.folderId) ? item.folderId : null)
    }
  }
  return { version: 2, folders, bookmarks: normalizeBrowserVisits(rawBookmarks).map(item => ({
    ...item, folderId: folderByUrl.get(item.url) ?? null,
  })) }
}

function migrateLegacy(scope: BookmarkScope): BrowserBookmarkLibrary {
  return { version: 2, folders: [], bookmarks: normalizeBrowserVisits(readBrowserList(oldKey(scope)))
    .map(bookmark => ({...bookmark, folderId:null})) }
}

export function hasBookmarkLibrary(scope: BookmarkScope): boolean {
  const value = readBrowserList(bookmarkLibraryKey(scope))
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && (value as {version?: unknown}).version === 2 && Array.isArray((value as {bookmarks?: unknown}).bookmarks)
    && Array.isArray((value as {folders?: unknown}).folders)
}

export function loadBookmarkLibrary(scope: BookmarkScope): BrowserBookmarkLibrary {
  return hasBookmarkLibrary(scope) ? normalizeBookmarkLibrary(readBrowserList(bookmarkLibraryKey(scope))) : migrateLegacy(scope)
}

/** One atomic localStorage write, followed by React state publication only if successful. */
export function saveBookmarkLibrary(scope: BookmarkScope, library: BrowserBookmarkLibrary): BrowserBookmarkLibrary {
  const normalized = normalizeBookmarkLibrary(library)
  writeBrowserPreference(bookmarkLibraryKey(scope), normalized)
  return normalized
}

function assertFolder(library: BrowserBookmarkLibrary, folderId: string | null) {
  if (folderId && !library.folders.some(folder => folder.id === folderId)) throw new Error('目标文件夹不存在')
}

function validatedName(library: BrowserBookmarkLibrary, name: string, parentId: string | null, exceptId?: string) {
  const result = cleanName(name)
  if (!result) throw new Error('请输入文件夹名称')
  if (library.folders.some(folder => folder.id !== exceptId && folder.parentId === parentId && folder.name === result))
    throw new Error('同一目录下已存在同名文件夹')
  return result
}

export function createBookmarkFolder(library: BrowserBookmarkLibrary, name: string, parentId: string | null,
  id: string, createdAt = Date.now()): BrowserBookmarkLibrary {
  assertFolder(library, parentId)
  if (!validId(id) || library.folders.some(folder => folder.id === id)) throw new Error('文件夹标识无效')
  if (library.folders.length >= 1000) throw new Error('最多创建 1000 个文件夹')
  return {...library, folders:[...library.folders, {id, name: validatedName(library, name, parentId), parentId, createdAt}]}
}

export function renameBookmarkFolder(library: BrowserBookmarkLibrary, id: string, name: string): BrowserBookmarkLibrary {
  const folder = library.folders.find(item => item.id === id)
  if (!folder) throw new Error('文件夹不存在')
  const nextName = validatedName(library, name, folder.parentId, id)
  return {...library, folders: library.folders.map(item => item.id === id ? {...item, name:nextName} : item)}
}

export function bookmarkFolderDescendants(library: BrowserBookmarkLibrary, id: string): Set<string> {
  const ids = new Set([id])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of library.folders) if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) {
      ids.add(folder.id)
      changed = true
    }
  }
  return ids
}

export function moveBookmarkFolder(library: BrowserBookmarkLibrary, id: string, parentId: string | null): BrowserBookmarkLibrary {
  const folder = library.folders.find(item => item.id === id)
  if (!folder) throw new Error('文件夹不存在')
  assertFolder(library, parentId)
  if (parentId && bookmarkFolderDescendants(library, id).has(parentId)) throw new Error('不能移动到自身或子文件夹')
  validatedName(library, folder.name, parentId, id)
  return {...library, folders:library.folders.map(item => item.id === id ? {...item, parentId} : item)}
}

/** Deleting a folder deletes its entire subtree and contained bookmarks (after explicit confirmation). */
export function deleteBookmarkFolder(library: BrowserBookmarkLibrary, id: string): BrowserBookmarkLibrary {
  if (!library.folders.some(item => item.id === id)) throw new Error('文件夹不存在')
  const descendants = bookmarkFolderDescendants(library, id)
  return {...library, folders:library.folders.filter(folder => !descendants.has(folder.id)),
    bookmarks:library.bookmarks.filter(bookmark => !bookmark.folderId || !descendants.has(bookmark.folderId))}
}

export function moveBookmarks(library: BrowserBookmarkLibrary, urls: readonly string[], folderId: string | null): BrowserBookmarkLibrary {
  assertFolder(library, folderId)
  const selected = new Set(urls)
  return {...library, bookmarks:library.bookmarks.map(bookmark =>
    selected.has(bookmark.url) ? {...bookmark, folderId} : bookmark)}
}

export function deleteBookmarks(library: BrowserBookmarkLibrary, urls: readonly string[]): BrowserBookmarkLibrary {
  const selected = new Set(urls)
  return {...library, bookmarks:library.bookmarks.filter(bookmark => !selected.has(bookmark.url))}
}

export function editBookmark(library: BrowserBookmarkLibrary, oldUrl: string, title: string, address: string,
  folderId?: string | null): BrowserBookmarkLibrary {
  const item = library.bookmarks.find(bookmark => bookmark.url === oldUrl)
  if (!item) throw new Error('书签不存在')
  const name = cleanName(title, 160)
  if (!name) throw new Error('请输入书签名称')
  const normalized = normalizeBrowserVisits([{url:address.trim(),title:name,time:item.time}])[0]
  if (!normalized) throw new Error('请输入有效的 HTTP 或 HTTPS 网址')
  if (library.bookmarks.some(bookmark => bookmark.url === normalized.url && bookmark.url !== oldUrl))
    throw new Error('该网址已存在于书签中')
  const target = folderId === undefined ? item.folderId : folderId
  assertFolder(library, target)
  return {...library,bookmarks: library.bookmarks.map(bookmark =>
    bookmark.url === oldUrl ? {...normalized,folderId:target} : bookmark)}
}

export function addBookmark(library: BrowserBookmarkLibrary, name: string, address: string,
  folderId: string | null, time = Date.now()): BrowserBookmarkLibrary {
  assertFolder(library, folderId)
  const title = cleanName(name, 160)
  if (!title) throw new Error('请输入书签名称')
  const normalized = normalizeBrowserVisits([{url:address.trim(),title,time}])[0]
  if (!normalized) throw new Error('请输入有效的 HTTP 或 HTTPS 网址')
  if (library.bookmarks.some(bookmark => bookmark.url === normalized.url)) throw new Error('该网址已存在于书签中')
  if (library.bookmarks.length >= 500) throw new Error('最多保存 500 个书签')
  return {...library, bookmarks:[{...normalized,folderId}, ...library.bookmarks]}
}

/** Returns root first, then valid folders in depth-first order for the destination picker. */
export function bookmarkFolderOptions(library: BrowserBookmarkLibrary, excludedId?: string): {id:string|null; label:string; depth:number}[] {
  const excluded = excludedId ? bookmarkFolderDescendants(library, excludedId) : new Set<string>()
  const result: {id:string|null;label:string;depth:number}[] = [{id:null,label:'根目录',depth:0}]
  const visit = (parentId: string | null, depth: number) => {
    for (const folder of library.folders.filter(item => item.parentId === parentId && !excluded.has(item.id))
      .sort((a,b) => a.name.localeCompare(b.name,'zh-CN'))) {
      result.push({id:folder.id,label:folder.name,depth})
      visit(folder.id,depth+1)
    }
  }
  visit(null,1)
  return result
}

export function bookmarkFolderPath(library: BrowserBookmarkLibrary, folderId: string | null): BrowserBookmarkFolder[] {
  const path: BrowserBookmarkFolder[] = []
  const map = new Map(library.folders.map(folder => [folder.id, folder]))
  const seen = new Set<string>()
  let id = folderId
  while (id && map.has(id) && !seen.has(id)) {
    seen.add(id)
    path.unshift(map.get(id)!)
    id = map.get(id)!.parentId
  }
  return path
}

export function newBookmarkFolderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return 'f_' + crypto.randomUUID().replace(/-/g, '')
  return 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 12)
}
