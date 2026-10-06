import assert from 'node:assert/strict'
import React, { act } from 'react'
import { parseHTML } from 'linkedom'

const { window } = parseHTML('<html><body></body></html>')
Object.assign(globalThis, { window, document: window.document, Node: window.Node, Element: window.Element, HTMLElement: window.HTMLElement, React, IS_REACT_ACT_ENVIRONMENT: true })
window.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0) as any
window.cancelAnimationFrame = clearTimeout as any
const { createRoot } = await import('react-dom/client')
const { PrivateMessagesView } = await import('../src/features/linuxdo/ui/PrivateMessagesView')
const { createLinuxDoPrivateMessagesCache } = await import('../src/features/linuxdo/ui/privateMessagesCache')
const { linuxDoApi, linuxDoNotifications } = await import('../src/features/linuxdo/runtime')
const { LinuxDoApiError } = await import('../src/features/linuxdo/types')
const host = document.createElement('div'); document.body.append(host)
const root = createRoot(host)
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
const session: any = { authenticated: true, authMode: 'browser-session', currentUser: { id: 1, username: 'reader' } }
const cacheRef = { current: createLinuxDoPrivateMessagesCache() }
const menu = (topics: any[] = []) => ({ topics, users: [], unread_notifications: [], read_notifications: [] })
const topic = (id: number, title: string) => ({ id, title, slug: 'topic', posts_count: 4, highest_post_number: 7, last_read_post_number: 2, unread: 3, notification_level: 3, last_poster_username: 'alice' })
let handler: (url: string, options: any) => Promise<any> = async () => menu()
let reads = 0
linuxDoApi.getJson = async (url: string, options: any) => { reads++; return handler(url, options) }
const opened: Array<[number, number | undefined]> = []
const props = { session, cacheRef, onOpen: (item: any, position?: number) => opened.push([item.id, position]), onUnreadChange: () => {} }
const render = async (next = props) => { await act(async () => { root.render(<PrivateMessagesView {...next} />); await flush() }) }
const click = async (label: string) => {
  const button = Array.from(host.querySelectorAll('button')).find((item) => item.textContent === label || item.getAttribute('aria-label') === label)
  assert.ok(button, `missing ${label}`)
  await act(async () => { button.dispatchEvent(new window.Event('click', { bubbles: true })); await flush() })
}

await render()
assert.equal(reads, 1, 'an empty menu must not trigger a fetch loop')
assert.ok(host.textContent?.includes('暂无最近私信'))
await act(flush)
assert.equal(reads, 1)
handler = async () => { throw new LinuxDoApiError('forbidden', '无权限', 403) }
await click('刷新私信')
assert.ok(host.querySelector('[role="alert"]')?.textContent?.includes('无权限'))
assert.ok(!host.textContent?.includes('暂无最近私信'), 'a failed request must not claim an empty inbox')
handler = async () => menu([topic(1, '恢复后的私信')])
await click('重试私信')
assert.ok(host.textContent?.includes('恢复后的私信'))
await click('打开私信：恢复后的私信')
assert.deepEqual(opened.at(-1), [1, 3], 'open at the first unread post even when stream numbers have gaps')

let resolveInbox: ((value: any) => void) | undefined
let inboxSignal: AbortSignal | undefined
handler = async (url, options) => {
  if (url.includes('private-messages/')) { inboxSignal = options.signal; return new Promise((resolve) => { resolveInbox = resolve }) }
  return { topic_list: { topics: [topic(2, '已发送会话')], more_topics_url: null } }
}
await click('收件箱')
await click('收件箱')
assert.equal(inboxSignal?.aborted, false, 'tapping the active tab must not strand its pending request')
await click('已发送')
assert.equal(inboxSignal?.aborted, true)
await act(async () => { resolveInbox?.({ topic_list: { topics: [topic(3, '迟到的收件箱')] } }); await flush() })
assert.ok(host.textContent?.includes('已发送会话'))
assert.ok(!host.textContent?.includes('迟到的收件箱'), 'a superseded read must never replace the active filter')

let sentPage = 0
handler = async (url) => {
  if (url.includes('page=2')) {
    sentPage++
    if (sentPage === 1) throw new Error('第二页断网')
    return { topic_list: { topics: [topic(2, '已发送会话'), topic(4, '第二页会话')], more_topics_url: null } }
  }
  return { topic_list: { topics: [topic(2, '已发送会话')], more_topics_url: '/topics/private-messages-sent/reader.json?page=2' } }
}
await click('刷新私信')
await click('加载更早私信')
assert.ok(host.textContent?.includes('已发送会话'))
assert.ok(host.textContent?.includes('第二页断网'))
await click('重试私信')
assert.ok(host.textContent?.includes('第二页会话'))
assert.equal(host.querySelectorAll('[aria-label="打开私信：已发送会话"]').length, 1)
const scroller = host.querySelector('.overflow-y-auto') as HTMLElement
scroller.scrollTop = 360
await act(async () => { scroller.dispatchEvent(new window.Event('scroll')); await flush() })
await act(async () => { root.render(null); await flush() })
await render()
assert.ok(host.textContent?.includes('第二页会话'), 'returning must keep conversations loaded from later pages')
assert.equal((host.querySelector('.overflow-y-auto') as HTMLElement).scrollTop, 360, 'returning restores the selected list and its scroll position')
assert.equal(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent, '已发送')

handler = async (url) => {
  assert.ok(url.includes('/other/'), 'new account must start on its own recent menu')
  return menu()
}
await render({ ...props, session: { ...session, currentUser: { id: 2, username: 'other' } } })
assert.ok(!host.textContent?.includes('已发送会话'))
assert.equal(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent, '最近')
assert.equal(Object.keys(cacheRef.current.entries).length, 1, 'other account must not inherit previous cached pages')

handler = async () => ({ ...menu(), unread_notifications: [{ id: 8, notification_type: 16, read: false, data: { group_name: 'team' } }] })
await click('刷新私信')
linuxDoNotifications.markRead = async () => {}
linuxDoNotifications.unreadCount = async () => 0
handler = async (url) => { assert.ok(url.includes('/private-messages-group/other/team.json')); return { topic_list: { topics: [topic(5, '群组私信')] } } }
const groupButton = Array.from(host.querySelectorAll('button')).find((item) => item.getAttribute('aria-label')?.startsWith('打开私信：'))!
await act(async () => { groupButton.dispatchEvent(new window.Event('click', { bubbles: true })); await flush() })
assert.ok(host.textContent?.includes('群组私信'))
handler = async (url) => { assert.ok(url.endsWith('/other/user-menu-private-messages.json')); return menu() }
await click('返回个人私信')
assert.equal(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent, '最近')
await render({ ...props, session: { authenticated: false, authMode: 'none' } })
assert.ok(host.textContent?.includes('登录后可查看个人私信'))
assert.equal(Object.keys(cacheRef.current.entries).length, 0, 'logout clears all private list memory')
await act(async () => { root.unmount(); await flush() })
console.log('linuxdo-private-messages-view: ok')
