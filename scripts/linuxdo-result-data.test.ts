import assert from 'node:assert/strict'
import { LinuxDoSearchService } from '../src/features/linuxdo/search/service'
import { decodeNotifications } from '../src/features/linuxdo/api/decode'
import * as notificationModel from '../src/features/linuxdo/notification/model'

let payload: any = {
  topics: [{ id: 41, slug: 'reader', title: 'RSS 阅读器', posts_count: 9 }],
  posts: [{ id: 81, topic_id: 41, post_number: 6, username: 'alice', name: 'Alice', avatar_template: 'https://cdn.example/alice/{size}.png', blurb: '支持 <b>RSS</b><a href="https://example.com">更多</a><img src="https://example.com/image.png"><script>alert(1)</script>', created_at: '2026-10-05T01:00:00Z' }],
  users: [{ id: 7, username: 'bob', avatar_template: '//cdn.example/bob/{size}.png' }],
  grouped_search_result: { more_full_page_results: false, more_users: true },
}
const api = new LinuxDoSearchService({ getJson: async () => payload } as any)
const result = await api.search('rss')
assert.equal(result.posts[0].topicId, 41, 'flat Discourse posts must join topics by topic_id')
assert.equal(result.posts[0].topicTitle, 'RSS 阅读器')
assert.equal(result.posts[0].avatarTemplate, 'https://cdn.example/alice/96.png', 'absolute CDN avatars must not be prefixed with linux.do')
assert.equal(result.users[0].avatarTemplate, 'https://cdn.example/bob/96.png')
assert.doesNotMatch(result.posts[0].cooked, /<(script|a|img)\b/i, 'search preview must not create nested links or remote media in a tappable result')
assert.equal(result.hasMore, false, 'user continuation flags must not manufacture another post page')
assert.equal((await api.search('rss', 10)).hasMore, false, 'full-page search must stop at the upstream page limit')
payload = { posts: [{ id: 82, post_number: 2, username: 'charlie', avatar_template: '/charlie/{size}.png', blurb: '回复摘要', topic: { id: 42, slug: 'nested', title: '嵌套主题' } }], grouped_search_result: { more_full_page_results: false } }
const nested = await api.search('摘要')
assert.equal(nested.topics[0].id, 42, 'nested serializer topics must be available in topic results too')
assert.equal(nested.posts[0].avatarTemplate, 'https://linux.do/charlie/96.png')
assert.equal(nested.hasMore, false, 'nonempty last page must not manufacture another page')
const notice = decodeNotifications({ notifications: [{ id: 1, notification_type: 25, acting_user_name: 'Alice', acting_user_avatar_template: '//cdn.example/alice/{size}.png', data: JSON.stringify({ display_username: 'alice', topic_title: 'RSS 阅读器' }) }] })[0]
assert.equal((notificationModel as any).linuxDoNotificationActor(notice).username, 'alice')
assert.equal((notificationModel as any).linuxDoNotificationActor(notice).name, 'Alice')
assert.equal(notice.actingUserAvatarTemplate, 'https://cdn.example/alice/96.png')
assert.deepEqual((notificationModel as any).linuxDoNotificationActor(decodeNotifications({ notifications: [{ id: 2, notification_type: 14, data: {} }] })[0]), { username: undefined, name: undefined })
payload = { posts: [], grouped_search_result: { error: 'search overloaded' } }
await assert.rejects(api.search('rss'), /search overloaded/, 'server search rejection must not become an empty result')
console.log('Linux.do result data regression tests passed')
