import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'
const { window } = parseHTML('<!doctype html><html><body></body></html>')
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement, HTMLImageElement: window.HTMLImageElement, React, IS_REACT_ACT_ENVIRONMENT: true })
window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as any
const storage = new Map<string, string>()
Object.assign(globalThis, { localStorage: { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v), removeItem: (k: string) => storage.delete(k) } })
window.matchMedia = (() => ({ matches: true, addEventListener() {}, removeEventListener() {} })) as any
window.getComputedStyle = (() => ({ transform: 'none', getPropertyValue: () => '' })) as any
const { createRoot } = await import('react-dom/client')
const { SearchView, NotificationsView } = await import('../src/features/linuxdo/ui/CommunityViews')
const { createLinuxDoSearchCache } = await import('../src/features/linuxdo/ui/searchCache')
const { linuxDoApi } = await import('../src/features/linuxdo/runtime')
const host = document.createElement('div'); document.body.append(host)
const root = createRoot(host)
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const click = async (label: string) => { const b = [...host.querySelectorAll('button')].find(x => x.textContent?.trim() === label || x.getAttribute('aria-label') === label); assert.ok(b, label); await act(async () => { if (b.getAttribute('type') === 'submit') b.closest('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); else b.click(); await flush() }) }
const result = (title: string, more = false) => ({ topics: [{ id: 41, slug: 'reader', title, posts_count: 9 }], posts: [{ id: 81, topic_id: 41, post_number: 6, username: 'alice', name: 'Alice', avatar_template: 'https://cdn.example/alice/{size}.png', blurb: '支持 <b>RSS</b>', created_at: '2026-10-05' }], grouped_search_result: { more_full_page_results: more } })
linuxDoApi.getJson = async () => result('RSS 阅读器') as any
const cacheRef = { current: { ...createLinuxDoSearchCache(), query: 'rss' } }
const opened: any[] = []
await act(async () => { root.render(<SearchView cacheRef={cacheRef} onOpen={(...args) => opened.push(args)} onOpenUser={() => {}} />); await flush() })
await click('搜索')
assert.ok(host.textContent?.includes('Alice'), 'topic search must display the matching post author, not Linux.do')
assert.equal(host.querySelector('img')?.getAttribute('src'), 'https://cdn.example/alice/96.png')
assert.ok(host.textContent?.includes('支持 RSS'), 'topic search must include the matching excerpt')
await click('打开搜索结果：RSS 阅读器')
assert.equal(opened[0][1], 6, 'topic result must open the matching floor')
assert.equal(host.textContent?.includes('加载更多结果'), false)
await click('帖子')
assert.equal(host.querySelector('img')?.getAttribute('src'), 'https://cdn.example/alice/96.png', 'post result must also show avatar')
assert.deepEqual([...host.querySelectorAll('[role="tab"]')].map(tab => tab.textContent), ['帖子', '类别与标签', '用户'])
const typeRequests: string[] = []
linuxDoApi.getJson = async (url: string) => {
  typeRequests.push(url)
  if (url.includes('search/users')) return { users: [{ id: 7, username: 'rss-user', name: 'RSS 成员' }] } as any
  if (url.includes('/categories')) return { category_list: { categories: [{ id: 12, name: 'RSS 阅读', slug: 'rss' }] } } as any
  if (url.includes('/tags/filter/search')) return { results: [{ name: 'rss', count: 9 }] } as any
  return result('RSS 阅读器') as any
}
await click('用户')
assert.ok(typeRequests.at(-1)?.includes('/u/search/users.json'), 'switching tabs must issue the appropriate search')
assert.ok(host.textContent?.includes('RSS 成员'))
await click('类别与标签')
assert.ok(host.textContent?.includes('RSS 阅读'))
assert.ok(host.textContent?.includes('#rss'))
await click('帖子')
assert.ok(host.textContent?.includes('RSS 阅读器'), 'switching back restores the saved post results')
const postRequestsBeforeSort = typeRequests.length
await click('排序：相关性')
const sortOption = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '赞最多')
assert.ok(sortOption)
await act(async () => { sortOption.click(); await flush() })
assert.equal(typeRequests.length, postRequestsBeforeSort + 1)
assert.equal(new URL(typeRequests.at(-1)!).searchParams.get('q'), 'rss order:likes', 'sort must requery upstream, not reorder the current page')
await click('高级筛选')
assert.ok(document.querySelector('[role="dialog"]'), 'advanced filters must open an accessible dialog')
assert.ok(document.querySelector<HTMLInputElement>('[aria-label="作者用户名"]'))
const cancelFilters = document.querySelector<HTMLButtonElement>('[aria-label="关闭高级筛选"]')!
await act(async () => { cancelFilters.click(); await flush() })
assert.equal(document.querySelector('[role="dialog"]'), null)
assert.equal(cacheRef.current.query, 'rss order:likes', 'cancel must not apply filter drafts')
await act(async () => { root.render(<SearchView cacheRef={cacheRef} categoriesById={{ 12: { id: 12, name: '开发调优', slug: 'dev' } }} onOpen={(...args) => opened.push(args)} onOpenUser={() => {}} />); await flush() })
await click('高级筛选')
const sheetClick = async (name: string) => {
  const button = [...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent?.trim() === name || button.getAttribute('aria-label') === name) as HTMLButtonElement
  assert.ok(button, name)
  await act(async () => { if (button.type === 'submit') button.closest('form')!.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); else button.click(); await flush() })
}
await sheetClick('选择搜索分类')
await sheetClick('开发调优')
assert.equal(cacheRef.current.query, 'rss order:likes', 'editing a filter must not immediately submit it')
await sheetClick('应用并搜索')
assert.equal(new URL(typeRequests.at(-1)!).searchParams.get('q'), 'rss category:12 order:likes')
assert.ok(host.querySelector('[aria-label="移除条件：分类：开发调优"]'))
await click('移除条件：分类：开发调优')
assert.equal(new URL(typeRequests.at(-1)!).searchParams.get('q'), 'rss order:likes')
// A response from the old query must not overwrite results after clearing.
let resolveOld!: (value: any) => void
linuxDoApi.getJson = async () => await new Promise(resolve => { resolveOld = resolve }) as any
await click('搜索')
await click('清空搜索词')
await act(async () => { resolveOld(result('过期结果')); await flush() })
assert.equal(host.textContent?.includes('过期结果'), false, 'clear must invalidate an in-flight response')
// History selections submit immediately; the latest query wins out of order.
storage.set('newsnook-linuxdo-search-history', JSON.stringify(['first', 'second']))
const pending = new Map<string, (value: any) => void>()
let searchRequests = 0
linuxDoApi.getJson = async (url: string) => await new Promise(resolve => { searchRequests++; pending.set(new URL(url).searchParams.get('q')!, resolve) }) as any
const raceCache = { current: createLinuxDoSearchCache() }
await act(async () => { root.render(<SearchView key="race" cacheRef={raceCache} onOpen={() => {}} onOpenUser={() => {}} />); await flush() })
await click('first')
await click('搜索')
assert.equal(searchRequests, 1, 'repeated submit must not duplicate a pending identical query')
await click('second')
const laterFocus = document.createElement('input')
let unexpectedBlur = 0
laterFocus.blur = () => { unexpectedBlur++ }
Object.defineProperty(document, 'activeElement', { configurable: true, get: () => laterFocus })
await act(async () => { pending.get('second')!(result('新搜索结果', true)); await flush() })
await act(async () => { pending.get('first')!(result('旧搜索结果')); await flush() })
assert.equal(unexpectedBlur, 0, 'a late response must not close a keyboard opened after submission')
delete (document as any).activeElement
assert.ok(host.textContent?.includes('新搜索结果'))
assert.equal(host.textContent?.includes('旧搜索结果'), false)
// Failure on page 2 preserves results and retries page 2, not page 1.
let failMore = true
let requestedPage = 0
linuxDoApi.getJson = async (url: string) => { requestedPage = Number(new URL(url).searchParams.get('page')); if (failMore) throw new Error('offline'); return { topics: [{ id: 42, title: '第二页' }], posts: [{ id: 82, topic_id: 42, username: 'bob', post_number: 2, avatar_template: '/bob/{size}.png', blurb: '新的匹配' }], grouped_search_result: { more_full_page_results: false } } as any }
await click('加载更多结果')
assert.equal(requestedPage, 2)
assert.ok(host.textContent?.includes('新搜索结果'))
assert.ok(host.textContent?.includes('offline'))
failMore = false
await click('offline · 点击重试')
assert.equal(requestedPage, 2)
assert.ok(host.textContent?.includes('第二页'))
const scroller = host.querySelector('.overflow-y-auto') as HTMLElement
assert.ok(scroller, 'search results must live in a dedicated scroll container')
scroller.scrollTop = 220
await act(async () => { scroller.dispatchEvent(new window.Event('scroll')); await flush() })
await act(async () => { root.render(<div />); await flush() })
await act(async () => { root.render(<SearchView cacheRef={raceCache} onOpen={() => {}} onOpenUser={() => {}} />); await flush() })
assert.equal((host.querySelector('.overflow-y-auto') as HTMLElement).scrollTop, 220, 'return must restore loaded page and position')
assert.ok(host.textContent?.includes('第二页'))
const { LinuxDoApiError } = await import('../src/features/linuxdo/types')
let loginOpened = false
linuxDoApi.getJson = async () => { throw new LinuxDoApiError('auth-required', '请先登录 Linux.do') }
await act(async () => { root.render(<SearchView key="login-required" cacheRef={{ current: { ...createLinuxDoSearchCache(), query: 'rss' } }} onOpen={() => {}} onOpenUser={() => {}} onLogin={() => { loginOpened = true }} />); await flush() })
await click('搜索')
await click('登录 LinuxDO')
assert.equal(loginOpened, true, 'login-required search must provide an actionable login entry')
let verified = false
linuxDoApi.getJson = async () => { if (!verified) throw new LinuxDoApiError('browser-verification', '需要安全验证'); return result('验证后的结果') as any }
await act(async () => { root.render(<SearchView key="verification" cacheRef={{ current: { ...createLinuxDoSearchCache(), query: 'rss' } }} onOpen={() => {}} onOpenUser={() => {}} onVerify={async () => { verified = true; return true }} />); await flush() })
await click('搜索')
await click('完成安全验证')
assert.ok(host.textContent?.includes('验证后的结果'), 'successful verification must retry the failed search')
// Real notification service decoding, including JSON-string data.
linuxDoApi.getJson = async (url: string) => (url.includes('session/current') ? { current_user: { id: 1, username: 'self', all_unread_notifications_count: 1 } } : { notifications: [{ id: 5, notification_type: 25, topic_id: 41, post_number: 6, slug: 'reader', read: false, acting_user_name: 'Alice', acting_user_avatar_template: '/alice/{size}.png', data: JSON.stringify({ display_username: 'alice', topic_title: 'RSS 阅读器' }), created_at: '2026-10-05' }] }) as any
linuxDoApi.putForm = async () => ({}) as any
await act(async () => { root.render(<NotificationsView session={{ authenticated: true, authMode: 'browser', currentUser: { id: 1, username: 'self' } } as any} onOpen={(...args) => opened.push(args)} onOpenUser={() => {}} onUnreadChange={() => {}} />); await flush() })
assert.ok(host.textContent?.includes('Alice'), 'notification actor must be visible')
assert.equal(host.querySelector('img')?.getAttribute('src'), 'https://linux.do/alice/96.png')
assert.ok(host.querySelector('[aria-label="未读通知"]'))
await click('打开通知：RSS 阅读器')
assert.equal(opened.at(-1)[1], 6)
const { avatar } = await import('../src/features/linuxdo/ui/utils')
await act(async () => { root.render(<div>{avatar('/failed.png', 'alice')}</div>); await flush() })
await act(async () => { host.querySelector('img')!.dispatchEvent(new window.Event('error')); await flush() })
assert.equal(host.querySelector('img'), null)
await act(async () => { root.render(<div>{avatar('/valid.png', 'bob')}</div>); await flush() })
assert.equal(host.querySelector('img')?.getAttribute('src'), '/valid.png', 'a failed previous avatar must not suppress a new user or refreshed URL')
await act(async () => { root.unmount(); await flush() })
console.log('Linux.do result view regression tests passed')
