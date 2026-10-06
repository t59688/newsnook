import assert from 'node:assert/strict'
import {
  parseLinuxDoSearch,
  buildLinuxDoSearch,
  emptyLinuxDoSearchFilters,
} from '../src/features/linuxdo/search/query'
import { LinuxDoSearchService } from '../src/features/linuxdo/search/service'

const parsed = parseLinuxDoSearch(
  '"手机 型号" category:12 tags:android+mobile @alice in:title in:bookmarks after:2026-01-01 min_views:100 order:likes custom:value'
)
assert.equal(
  parsed.text,
  '"手机 型号" custom:value',
  'quoted phrases and unsupported syntax must survive form editing'
)
assert.equal(parsed.filters.category, '12')
assert.equal(parsed.filters.tags, 'android, mobile')
assert.equal(parsed.filters.allTags, true)
assert.equal(parsed.filters.author, 'alice')
assert.deepEqual(parsed.filters.scopes, ['title', 'bookmarks'])
assert.equal(parsed.order, 'likes')
assert.equal(
  buildLinuxDoSearch(parsed),
  '"手机 型号" custom:value category:12 tags:android+mobile @alice in:title in:bookmarks after:2026-01-01 min_views:100 order:likes'
)
assert.throws(
  () =>
    buildLinuxDoSearch({
      text: 'rss',
      order: 'relevance',
      filters: { ...emptyLinuxDoSearchFilters(), minPosts: '9', maxPosts: '2' },
    }),
  /帖子数/
)
assert.throws(
  () =>
    buildLinuxDoSearch({
      text: 'rss',
      order: 'relevance',
      filters: { ...emptyLinuxDoSearchFilters(), after: '2026-10-06', before: '2026-01-01' },
    }),
  /日期/
)
assert.throws(
  () =>
    buildLinuxDoSearch({
      text: 'rss',
      order: 'relevance',
      filters: { ...emptyLinuxDoSearchFilters(), author: 'alice order:views' },
    }),
  /作者/
)
assert.equal(
  parseLinuxDoSearch('rss order:views order:likes').order,
  'likes',
  'the form must normalize duplicate sort directives'
)
assert.equal(
  parseLinuxDoSearch('rss after:2026-99-99').text,
  'rss after:2026-99-99',
  'invalid hand-written dates must not crash the input'
)
assert.equal(parseLinuxDoSearch('rss after:2026-02-30').text, 'rss after:2026-02-30')
assert.equal(
  parseLinuxDoSearch('"unfinished').text,
  '"unfinished',
  'editing an unfinished phrase must preserve its quote'
)
assert.ok(
  !buildLinuxDoSearch({ ...parsed, order: 'relevance' }).includes('order:'),
  'relevance must remove the prior explicit sort'
)

const requests: string[] = []
const service = new LinuxDoSearchService({
  getJson: async (url: string, options: any) => {
    requests.push(url)
    assert.equal(options.signal, controller.signal)
    if (url.includes('search/users'))
      return { users: [{ id: 7, username: 'alice', name: 'Alice', avatar_template: '/alice/{size}.png' }] }
    if (url.includes('/categories'))
      return {
        category_list: {
          categories: [
            { id: 12, name: '开发调优', slug: 'dev' },
            { id: 13, name: '资源', slug: 'resource' },
          ],
        },
      }
    if (url.includes('/tags/filter/search')) return { results: [{ id: 1, name: '开发', count: 8 }] }
    return { posts: [], grouped_search_result: { more_full_page_results: true, more_users: true } }
  },
} as any)
const controller = new AbortController()
const users = await service.searchUsers('@alice', controller.signal)
assert.equal(new URL(requests[0]).pathname, '/u/search/users.json', 'user tab must use dedicated user search')
assert.equal(new URL(requests[0]).searchParams.get('term'), 'alice')
assert.equal(users.users[0].username, 'alice')
assert.equal(users.hasMore, false, 'bounded user results must not borrow post pagination')
const scopes = await service.searchCategories('开发', controller.signal)
assert.deepEqual(
  scopes.categories.map((c) => c.id),
  [12]
)
assert.equal(scopes.tags[0].name, '开发')
assert.equal(scopes.hasMore, false)
const lastPage = await service.search('rss', 10, controller.signal)
assert.equal(lastPage.hasMore, false, 'Discourse full-page search stops at page 10')
await assert.rejects(
  service.search('rss', 11, controller.signal),
  /页数/,
  'invalid pages must be rejected before requesting upstream'
)
const malformed = new LinuxDoSearchService({
  getJson: async () => ({ message: 'unexpected payload' }),
} as any)
await assert.rejects(
  malformed.search('rss'),
  /无法识别/,
  'malformed success responses must not become fake empty results'
)
console.log('LinuxDO search query and transport tests passed')
