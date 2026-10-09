import assert from 'node:assert/strict'

import { ZhihuCollectionService, decodeZhihuCollectionDetail } from '../src/features/zhihu/collection/service'
import { ZhihuPeopleService, decodeZhihuPeopleColumn, decodeZhihuPeopleProfile } from '../src/features/zhihu/people/service'
import { ZhihuTopicService, decodeZhihuTopicDetail } from '../src/features/zhihu/topic/service'

const profile = decodeZhihuPeopleProfile({
  id: 'person-1',
  url_token: 'person-token',
  name: '示例用户',
  headline: '示例签名',
  follower_count: 42,
  following_count: 8,
  answer_count: 7,
  articles_count: 3,
  is_blocking: true,
})
assert.equal(profile.token, 'person-token')
assert.equal(profile.followerCount, 42)
assert.equal(profile.followingCount, 8)
assert.equal(profile.isBlocking, true)

const column = decodeZhihuPeopleColumn({
  id: 'column-1',
  title: '示例专栏',
  description: '专栏说明',
  url: 'https://www.zhihu.com/api/v4/columns/column-1',
  articles_count: 17,
  followers: 39,
  follower_count: 21,
  is_following: true,
})
assert.equal(column.url, 'https://www.zhihu.com/column/column-1')
assert.equal(column.articlesCount, 17)
assert.equal(column.followerCount, 39, '专栏 followerCount 应兼容 followers/follower_count 并取可用较大值')
assert.equal(column.isFollowing, true)

const topic = decodeZhihuTopicDetail({
  id: 'topic-1',
  name: '示例话题',
  excerpt: '话题简介',
  followers_count: 88,
  questions_count: 12,
})
assert.equal(topic.name, '示例话题')
assert.equal(topic.questionsCount, 12)

const collection = decodeZhihuCollectionDetail({
  collection: {
    id: 'collection-1',
    title: '示例收藏夹',
    description: '说明',
    is_public: true,
    item_count: 12,
    follower_count: 5,
    creator: { id: 'creator-1', url_token: 'creator-token', name: '创建者' },
  },
})
assert.equal(collection.title, '示例收藏夹')
assert.equal(collection.creator?.token, 'creator-token')

const calls: Array<{ operation: string; url: string }> = []
const api = {
  async getJson(operation: string, url: string) {
    calls.push({ operation, url })
    if (operation === 'people.read') return { id: 'person-1', url_token: 'person-token', name: '示例用户' }
    if (operation === 'topic.read') return { id: 'topic-1', name: '示例话题' }
    if (operation === 'collection.read') return {
      collection: { id: 'collection-1', title: '示例收藏夹', is_public: true, item_count: 1 },
    }
    if (operation === 'collection.items') return {
      data: [{
        created: '1789458000',
        content: {
          id: 'answer-in-collection',
          type: 'answer',
          excerpt: '收藏回答摘要',
          question: { id: 'q-collection', title: '收藏里的问题' },
          author: { id: 'author-1', name: '回答者' },
        },
      }],
      paging: { is_end: false, next: 'https://www.zhihu.com/api/v4/collections/collection-1/items?offset=20&limit=20' },
    }
    if (operation === 'people.activities') return {
      data: [{ target: { id: 'activity-answer', type: 'answer', excerpt: '动态回答', question: { id: 'q-a', title: '动态问题' }, author: { id: 'a', name: '甲' } } }],
      paging: { is_end: true },
    }
    if (operation === 'people.followers' || operation === 'people.following') return {
      data: [{ id: 'relation-person', url_token: 'relation-token', name: '关系用户', follower_count: 9 }],
      paging: { is_end: false, next: 'https://www.zhihu.com/api/v4/members/person-token/followees?offset=20&limit=20' },
    }
    if (operation === 'people.following-questions') return {
      data: [{ id: 'followed-question', type: 'question', title: '关注的问题', excerpt: '问题说明' }],
      paging: { is_end: true },
    }
    if (operation === 'people.following-topics') return {
      data: [{ topic: { id: 'followed-topic', type: 'topic', name: '关注的话题', excerpt: '话题说明' } }],
      paging: { is_end: true },
    }
    if (operation === 'people.collections' || operation === 'people.following-collections') return {
      data: [{ id: 'people-collection', title: '用户收藏夹', description: '收藏夹说明', follower_count: 3 }],
      paging: { is_end: true },
    }
    if (operation === 'people.columns' || operation === 'people.following-columns') return {
      data: [{
        id: 'people-column',
        title: '用户专栏',
        description: '专栏说明',
        url: 'https://www.zhihu.com/api/v4/columns/people-column',
        articles_count: 8,
        followers: 16,
      }],
      paging: { is_end: true },
    }
    return {
      data: [{ id: 'answer-1', type: 'answer', content: '<p>正文</p>', question: { id: 'q-1', title: '问题' } }],
      paging: { is_end: false, next: 'https://www.zhihu.com/api/v4/next' },
    }
  },
}

const peopleService = new ZhihuPeopleService(api)
await peopleService.read('person-token')
assert.equal(calls.at(-1)?.url, 'https://api.zhihu.com/people/person-token')
const peopleContentCallCount = calls.length
const peoplePage = await peopleService.listContent('person-token', 'answers')
assert.equal(peoplePage.nextCursor, 'https://www.zhihu.com/api/v4/next')
assert.equal(calls.length, peopleContentCallCount + 1, '用户内容首屏必须只发一次精确协议请求')
assert.equal(calls.at(-1)?.operation, 'people.content')
assert.ok(calls.at(-1)?.url.includes('/members/person-token/answers'))
assert.ok(calls.at(-1)?.url.includes('sort_by=voteups'))
assert.ok(calls.at(-1)?.url.includes('include='), '用户内容首屏必须携带该内容类型所需 include 字段')
await peopleService.listContent('person-token', 'answers', 'https://www.zhihu.com/api/v4/members/person-token/answers?offset=20&limit=20')
assert.ok(calls.at(-1)?.url.includes('offset=20'))
await peopleService.listContent('person-token', 'pins')
assert.ok(calls.at(-1)?.url.includes('/api/v4/v2/pins/person-token/moments'), '用户想法不能套用 members/:token/pins 错误模板')
assert.ok(calls.at(-1)?.url.includes('include='))

await assert.rejects(
  peopleService.listContent('person-token', 'answers', 'https://evil.example/steal'),
  /允许域内|请求目标不在允许域内/,
  '用户内容翻页必须拒绝非知乎 next URL',
)
const activityPage = await peopleService.listActivities('person-token')
assert.equal(activityPage.items[0]?.ref.id, 'activity-answer')
const followersPage = await peopleService.listRelations(profile, 'followers')
assert.equal(followersPage.items[0]?.token, 'relation-token')
assert.equal(calls.at(-1)?.operation, 'people.followers')
const followingPage = await peopleService.listRelations(profile, 'following')
assert.equal(followingPage.items[0]?.name, '关系用户')
assert.equal(calls.at(-1)?.operation, 'people.following')
const followedQuestions = await peopleService.listFollowingEntities('person-token', 'questions')
assert.equal(followedQuestions.items[0]?.ref.kind, 'question')
const followedTopics = await peopleService.listFollowingEntities('person-token', 'topics')
assert.equal(followedTopics.items[0]?.ref.kind, 'topic')
assert.equal(followedTopics.items[0]?.url, 'https://www.zhihu.com/topic/followed-topic/hot')
const userCollections = await peopleService.listCollections('person-token', 'collections')
assert.equal(userCollections.items[0]?.ref.kind, 'collection')
assert.equal(userCollections.items[0]?.url, 'https://www.zhihu.com/collection/people-collection')
assert.equal(calls.at(-1)?.operation, 'people.collections')
const followedCollections = await peopleService.listCollections('person-token', 'following-collections')
assert.equal(followedCollections.items[0]?.ref.id, 'people-collection')
assert.equal(calls.at(-1)?.operation, 'people.following-collections')
const columns = await peopleService.listColumns('person-token', 'columns')
assert.equal(columns.items[0]?.title, '用户专栏')
assert.equal(columns.items[0]?.url, 'https://www.zhihu.com/column/people-column')
assert.equal(calls.at(-1)?.operation, 'people.columns')
assert.ok(calls.at(-1)?.url.includes('/members/person-token/column-contributions'))
assert.ok(calls.at(-1)?.url.includes('include='), '专栏贡献必须携带 articles_count/followers/author include')
const followedColumns = await peopleService.listColumns('person-token', 'following-columns')
assert.equal(followedColumns.items[0]?.followerCount, 16)
assert.equal(calls.at(-1)?.operation, 'people.following-columns')
assert.ok(calls.at(-1)?.url.includes('/members/person-token/following-columns'))
await assert.rejects(
  peopleService.listColumns('person-token', 'columns', 'https://evil.example/columns'),
  /允许域内|请求目标不在允许域内/,
  '专栏翻页必须拒绝非知乎 next URL',
)

const topicService = new ZhihuTopicService(api)
await topicService.read('topic-1')
const topicPage = await topicService.listHot('topic-1')
assert.equal(topicPage.nextCursor, 'https://www.zhihu.com/api/v4/next')
assert.equal(calls.at(-1)?.operation, 'topic.feed')
assert.ok(calls.at(-1)?.url.includes('/topics/topic-1/feeds/essence/v2'))
assert.ok(calls.at(-1)?.url.includes('offset=0'))
await topicService.listHot('topic-1', 'https://www.zhihu.com/api/v5.1/topics/topic-1/feeds/essence/v2?limit=20&offset=20')
assert.ok(calls.at(-1)?.url.includes('offset=20'))
await assert.rejects(
  topicService.listHot('topic-1', 'https://evil.example/topic-next'),
  /请求目标不在允许域内/,
  '话题翻页必须拒绝非知乎 next URL',
)

const collectionService = new ZhihuCollectionService(api)
const collectionDetail = await collectionService.read('collection-1')
assert.equal(collectionDetail.itemCount, 1)
const collectionPage = await collectionService.items('collection-1')
assert.equal(collectionPage.items[0]?.ref.kind, 'answer')
assert.equal(collectionPage.items[0]?.ref.id, 'answer-in-collection')
assert.match(collectionPage.nextCursor ?? '', /offset=20/)

console.log('zhihu people/topic service contract ok')
