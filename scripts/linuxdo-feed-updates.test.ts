import assert from 'node:assert/strict'
import { linuxDoEndpoints } from '../src/features/linuxdo/api/endpoints'

assert.equal(typeof (linuxDoEndpoints as any).messageBusPoll, 'function', 'feed updates require the official MessageBus poll endpoint')
const { LinuxDoFeedUpdates } = await import('../src/features/linuxdo/feed/updates')
const calls: any[] = []
let response: unknown = []
const api: any = { postForm: async (...args: any[]) => { calls.push(args); return response } }
const updates = new LinuxDoFeedUpdates(api, 7, 'test-client')
response = [{ channel: '/__status', data: { '/latest': 100, '/new': 50, '/unread': 20, '/unread/7': 30, '/delete': 1 } }]
await updates.poll()
assert.equal(calls[0][0], 'https://ping.ldstatic.com/message-bus/test-client/poll?dlp=t', 'Linux.do serves MessageBus on its separate polling origin')
assert.equal(calls[0][1]['/latest'], -1, 'first poll starts at the present rather than replaying historical topics')
assert.equal(calls[0][2].csrf, false)
assert.equal(calls[0][2].headers['Dont-Chunk'], 'true')
assert.equal(updates.count('latest'), 0, 'status messages only establish the channel cursors')
response = [
  { channel: '/latest', message_id: 101, data: { topic_id: 10, message_type: 'latest' } },
  { channel: '/latest', message_id: 102, data: { topic_id: 10, message_type: 'latest' } },
  { channel: '/latest', message_id: 103, data: { topic_id: 11, message_type: 'latest' } },
  { channel: '/new', message_id: 51, data: { topic_id: 11, message_type: 'new_topic' } },
  { channel: '/unread', message_id: 21, data: { topic_id: 12, message_type: 'unread' } },
  { channel: '/latest', message_id: 104, data: { topic_id: 13, message_type: 'muted' } },
  { channel: '/unknown', message_id: 9, data: { topic_id: 99, message_type: 'latest' } },
]
await updates.poll()
assert.equal(calls[1][1]['/latest'], 100)
assert.equal(updates.count('latest'), 2, 'updates deduplicate by topic, including new + latest events')
assert.equal(updates.count('new'), 1)
assert.equal(updates.count('unread'), 1)
assert.equal(updates.count('hot'), 0, 'latest events must not pollute ranked lists')
// Real Linux.do responses may end in a status frame after several event frames.
response = [
  { global_id: 800261723, channel: '/latest', message_id: 104, data: { topic_id: 2894581, message_type: 'latest' } },
  { global_id: -1, channel: '/__status', message_id: -1, data: { '/latest': 104, '/chat/new-channel': 31109 } },
]
await updates.poll()
assert.equal(updates.count('latest'), 2, 'the previously accepted message 104 is not replayed and status counters are not topic counts')
const beforeRefresh = updates.snapshot('latest')
response = [{ channel: '/latest', message_id: 105, data: { topic_id: 10, message_type: 'latest' } }]
await updates.poll()
updates.acknowledge('latest', beforeRefresh)
assert.equal(updates.count('latest'), 1, 'updates arriving during a refresh survive its acknowledgement')
assert.equal(updates.count('new'), 1, 'refreshing latest must not clear another tab')
response = [{ channel: '/delete', message_id: 2, data: { topic_id: 10, message_type: 'delete' } }]
await updates.poll()
assert.equal(updates.count('latest'), 0)
response = [null, { channel: '/latest', message_id: 106, data: { topic_id: -1, message_type: 'latest' } }]
await updates.poll()
assert.equal(updates.count('latest'), 0)
response = { unexpected: true }
await assert.rejects(updates.poll(), /无法识别/)
response = []
await updates.poll()
assert.equal(calls.at(-1)[1]['/latest'], 106, 'failed responses must retain the last accepted cursor')
const guest = new LinuxDoFeedUpdates(api, undefined, 'guest')
await guest.poll()
assert.equal(calls.at(-1)[1]['/new'], undefined, 'anonymous polling must not subscribe to personalized channels')
assert.equal(new LinuxDoFeedUpdates(api, 8, 'other').count('latest'), 0, 'each account begins with isolated state')
let release: ((value: unknown) => void) | undefined
const delayed = new LinuxDoFeedUpdates({ postForm: () => new Promise((resolve) => { release = resolve as (value: unknown) => void }) } as any, 7, 'delayed')
const controller = new AbortController()
const pendingPoll = delayed.poll(controller.signal)
controller.abort()
release!([{ channel: '/latest', message_id: 1, data: { topic_id: 99, message_type: 'latest' } }])
await pendingPoll
assert.equal(delayed.count('latest'), 0, 'abandoned native responses must not enter the old account state')
console.log('linuxdo-feed-updates: ok')
