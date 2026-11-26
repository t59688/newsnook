/** Explicit browser bookmarks only. Private browsing never auto-creates a bookmark.
 * Private and normal collections have independent persistence and removal paths.
 * UI disclosure is a temporary view state, not an authentication/encryption boundary.
 */
import { normalizeBrowserVisits, type BrowserVisit } from './browserHistory'
import { BROWSER_KEYS, readBrowserList, writeBrowserPreference } from './browserPreferences'
import { hasBookmarkLibrary, loadBookmarkLibrary, saveBookmarkLibrary } from './browserBookmarkLibrary'

export type BookmarkScope = 'normal' | 'private'
const bookmarkKey = (scope: BookmarkScope): string =>
  scope === 'private' ? BROWSER_KEYS.privateBookmarks : BROWSER_KEYS.bookmarks

export function loadBrowserBookmarks(scope: BookmarkScope): BrowserVisit[] {
  if (hasBookmarkLibrary(scope)) return loadBookmarkLibrary(scope).bookmarks.map(({url, title, time}) => ({url, title, time}))
  return normalizeBrowserVisits(readBrowserList(bookmarkKey(scope)))
}

/** Write before publishing UI changes, matching existing browser storage semantics. */
export function saveBrowserBookmarks(scope: BookmarkScope, entries: BrowserVisit[]): BrowserVisit[] {
  const normalized = normalizeBrowserVisits(entries)
  if (hasBookmarkLibrary(scope)) {
    const previous = loadBookmarkLibrary(scope)
    const folders = new Map(previous.bookmarks.map(item => [item.url, item.folderId]))
    saveBookmarkLibrary(scope, {...previous, bookmarks:normalized.map(item => ({...item, folderId:folders.get(item.url) ?? null}))})
  } else {
    // Existing flat installs keep their original V1 key until a manager edit needs folders.
    writeBrowserPreference(bookmarkKey(scope), normalized)
  }
  return normalized
}

export function toggleBrowserBookmark(
  entries: BrowserVisit[], address: string, title: string, time = Date.now(),
): {entries: BrowserVisit[]; added: boolean} {
  const entry = normalizeBrowserVisits([{url:address, title, time}])[0]
  if (!entry) return {entries, added:false}
  if (entries.some(item => item.url === entry.url)) {
    return {entries: entries.filter(item => item.url !== entry.url), added:false}
  }
  return {entries: normalizeBrowserVisits([entry, ...entries]), added:true}
}

export interface PrivateBookmarkTap { count: number; lastAt: number }
export const EMPTY_PRIVATE_BOOKMARK_TAP: PrivateBookmarkTap = {count:0, lastAt:0}
const TAP_INTERVAL_MS = 900

/** A timed five-tap gesture, reset on any unrelated page action. */
export function advancePrivateBookmarkTap(
  previous: PrivateBookmarkTap, now: number,
): {state: PrivateBookmarkTap; activated: boolean} {
  const consecutive = Number.isFinite(now) && now >= previous.lastAt &&
    now - previous.lastAt <= TAP_INTERVAL_MS
  const count = consecutive ? previous.count + 1 : 1
  if (count === 5) return {state: EMPTY_PRIVATE_BOOKMARK_TAP, activated:true}
  return {state:{count, lastAt:now}, activated:false}
}
