import assert from 'node:assert/strict'
import { LinuxDoProfileSectionsService } from '../src/features/linuxdo/people/sections'

const calls: Array<{ url: string; options: any }> = []
let payload: any = {}
const service = new LinuxDoProfileSectionsService({ getJson: async (url: string, options: any) => { calls.push({ url, options }); return payload } } as any)
const topic = { id: 42, title: 'Assigned', slug: 'assigned', posts_count: 3 }
for (const [section, path] of [['read', '/read.json'], ['assigned', '/topics/messages-assigned/reader.json'], ['votes', '/topics/voted-by/reader.json']] as const) {
  payload = { topic_list: { topics: [topic], more_topics_url: path.replace('.json', '') + '?page=3' } }
  const first = await service.list(section, 'reader')
  assert.equal(first.items[0].topic?.id, 42)
  await service.list(section, 'reader', first.next)
  assert.ok(calls.at(-1)?.url.endsWith('?page=3'), 'follow server pagination rather than assuming consecutive pages')
}
payload = { pending_posts: [{ id: 9, raw_text: '<script>raw</script>', title: 'Pending topic', topic_id: null }] }
const pending = await service.list('pending', 'reader')
assert.equal(pending.items[0].text, '<script>raw</script>')
assert.equal(pending.items[0].topic, undefined, 'a pending new topic has no published destination')
assert.equal(calls.at(-1)?.options.auth, 'required')
payload = { drafts: [{ draft_key: 'new_topic_7', sequence: 4, data: JSON.stringify({ action: 'createTopic', title: 'PWA draft', reply: 'Unpublished body', tags: ['test'], categoryId: 4 }) }] }
const drafts = await service.list('drafts', 'reader')
assert.equal(drafts.items[0].draft?.key, 'new_topic_7')
assert.equal(drafts.items[0].draft?.data?.title, 'PWA draft')
payload = Array.from({ length: 20 }, (_, i) => ({ id: 40 - i, reaction: { reaction_value: 'laughing' }, post: { id: i + 1, topic_id: 42, post_number: 7, excerpt: '<p>Reaction<script>bad()</script></p>', topic: { id: 42, title: 'Reacted topic', slug: 'reacted' } } }))
const reactions = await service.list('reactions', 'reader')
assert.equal(reactions.items[0].postNumber, 7)
assert.equal(reactions.items[0].reaction, 'laughing')
assert.ok(!reactions.items[0].html?.includes('<script'))
await service.list('reactions', 'reader', reactions.next)
assert.ok(calls.at(-1)?.url.includes('before_reaction_user_id=21'))
payload = [{ id: 6, post: { topic_id: 42, url: '/t/reacted/42/11', topic: { title: 'Reacted topic' } } }]
assert.equal((await service.list('reactions', 'reader')).items[0].postNumber, 11, 'parse floor from post URL when the plugin omits post_number')
payload = { user_solved_posts: Array.from({ length: 20 }, (_, i) => ({ post_id: i + 1, topic_id: 42, topic_title: 'Solved answer', post_number: 8, slug: 'solved', excerpt: '<p>Answer</p>' })) }
const solved = await service.list('solved', 'reader')
assert.equal(solved.items[0].postNumber, 8)
await service.list('solved', 'reader', solved.next)
assert.ok(calls.at(-1)?.url.includes('offset=20'))
assert.ok(calls.at(-1)?.url.includes('limit=20'))
const before = calls.length
await assert.rejects(service.list('read', 'reader', 'https://evil.example/read.json'), /分页/)
assert.equal(calls.length, before)
payload = { unexpected: [] }
await assert.rejects(service.list('pending', 'reader'), /无法识别/)
console.log('linuxdo-profile-sections: ok')
