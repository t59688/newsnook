import assert from 'node:assert/strict'
import { LinuxDoNotificationService } from '../src/features/linuxdo/notification/service'
import { linuxDoEndpoints } from '../src/features/linuxdo/api/endpoints'

const calls: Array<{ url: string; options: any }> = []
let payload: any = {
  unread_notifications: [{ id: 9, notification_type: 6, read: false, topic_id: 101, post_number: 3, created_at: '2026-10-05', acting_user_avatar_template: '/alice/{size}.png', data: { topic_title: '未读会话', display_username: 'alice' } }],
  read_notifications: [{ id: 10, notification_type: 16, read: true, created_at: '2026-10-04', data: { group_name: 'team', inbox_count: 2 } }],
  topics: [{ id: 102, title: '截图中的个人私信', slug: 'topic', posts_count: 3, highest_post_number: 5, last_read_post_number: 2, unread: 2, bumped_at: '2026-10-03', last_poster_username: 'bob', posters: [{ user_id: 7 }] }],
  users: [{ id: 7, username: 'bob', avatar_template: '/avatar/{size}.png' }],
}
const service = new LinuxDoNotificationService({ getJson: async (url: string, options: any) => { calls.push({ url, options }); return payload } } as any)
assert.equal(typeof service.recentPrivateMessages, 'function', 'the official user-menu private-message endpoint must be supported')
const recent = await service.recentPrivateMessages('a o/z')
assert.equal(calls[0]?.url, 'https://linux.do/u/a%20o%2Fz/user-menu-private-messages.json')
assert.equal(calls[0]?.options.auth, 'required')
assert.deepEqual(recent.map((row) => row.topic?.id ?? row.groupName), [101, 'team', 102])
assert.equal(recent[0]?.unread, true)
assert.equal(recent[0]?.avatarTemplate, 'https://linux.do/alice/96.png')
assert.equal(recent[2]?.sender, 'bob')
assert.equal(recent[2]?.avatarTemplate, 'https://linux.do/avatar/96.png')
assert.equal(recent[2]?.targetPostNumber, 3)
assert.equal(recent[2]?.title, '截图中的个人私信')
payload = { ...payload, topics: [...payload.topics, { ...payload.topics[0], id: 101 }] }
assert.equal((await service.recentPrivateMessages('reader')).filter((row) => row.topic?.id === 101).length, 1, 'unread notification wins over a duplicate conversation')
payload = { unread_notifications: [], read_notifications: [], topics: [], users: [] }
assert.deepEqual(await service.recentPrivateMessages('reader'), [])
payload = { error: 'invalid response' }
await assert.rejects(() => service.recentPrivateMessages('reader'), /私信数据/)
payload = { topic_list: { topics: [], more_topics_url: '/topics/private-messages-sent/reader.json?page=3' } }
assert.equal((await service.privateMessages('reader', 0, undefined, 'sent')).nextPage, 3)
assert.equal(calls.at(-1)?.url, 'https://linux.do/topics/private-messages-sent/reader.json')
for (const filter of ['inbox', 'new', 'unread', 'sent', 'archive'] as const) {
  assert.ok(linuxDoEndpoints.privateMessages('reader', 2, filter).includes(filter === 'inbox' ? '/private-messages/' : `/private-messages-${filter}/`))
}
for (const filter of ['inbox', 'new', 'unread', 'archive'] as const) {
  assert.equal(linuxDoEndpoints.privateMessages('reader', 2, filter, 'team'), `https://linux.do/topics/private-messages-group/reader/team${filter === 'inbox' ? '' : '/' + filter}.json?page=2`)
}
payload = { topic_list: { topics: [], more_topics_url: '?page=0' } }
assert.equal((await service.privateMessages('reader', 2)).nextPage, undefined, 'non-advancing pagination must stop')
const cacheModel = await import('../src/features/linuxdo/ui/privateMessagesCache')
assert.equal(typeof cacheModel.applyPrivateMessageReadProgress, 'function', 'server-accepted read progress must update the preserved private list')
const readCache = cacheModel.createLinuxDoPrivateMessagesCache()
readCache.entries[':recent'] = { loaded: true, scrollTop: 50, items: recent }
readCache.entries[':unread'] = { loaded: true, scrollTop: 0, items: recent.filter((row) => row.topic?.id === 102) }
cacheModel.applyPrivateMessageReadProgress(readCache, 102, 5)
assert.equal(readCache.entries[':unread']!.items.length, 0, 'fully read conversations must leave the unread filter')
assert.equal(readCache.entries[':recent']!.items.find((row) => row.topic?.id === 102)?.unread, false)
assert.equal(readCache.entries[':recent']!.items.find((row) => row.topic?.id === 102)?.targetPostNumber, 5)
assert.equal(readCache.entries[':recent']!.scrollTop, 50)
assert.equal(typeof cacheModel.markPrivateMessageNotificationRead, 'function')
cacheModel.markPrivateMessageNotificationRead(readCache, 10)
const summary = readCache.entries[':recent']!.items.find((row) => row.notification?.id === 10)
assert.equal(summary?.notification?.read, true)
assert.equal(summary?.unread, false)
cacheModel.markPrivateMessageNotificationRead(readCache, 9)
assert.equal(readCache.entries[':recent']!.items.find((row) => row.notification?.id === 9)?.notification?.read, true)
assert.equal(readCache.entries[':recent']!.items.find((row) => row.notification?.id === 9)?.unread, true, 'notification dismissal must not pretend the conversation was fully read')
console.log('linuxdo-private-messages: ok')
