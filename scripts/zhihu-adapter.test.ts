import assert from 'node:assert/strict'

import { encryptZhihuMd5, buildZhihuZse96 } from '../src/features/zhihu/signing'
import { normalizeZhihuList } from '../src/features/zhihu/normalize'
import { ZHIHU_MAIN_SOURCE } from '../src/sources/registry/zhihuMain'

console.log('--- Zhihu adapter regression tests ---')

assert.equal(
  encryptZhihuMd5('0123456789abcdef0123456789abcdef', 42),
  'AcsLmw4+iF0ZwoBwTNMf5nz3RxBNVxKTy2=dLgN=eqPX5FWFAas++M4fz/GZSCyR',
)
const signature = buildZhihuZse96(
  '/api/v4/questions/37811449?limit=5&offset=0',
  'fixture-d-c0',
  undefined,
  42,
)
assert.ok(signature.startsWith('2.0_'))
assert.equal(signature.length, 68)

const result = normalizeZhihuList(ZHIHU_MAIN_SOURCE, {
  data: [
    {
      target: {
        type: 'answer',
        id: 89226347214,
        excerpt: '<p>一段回答摘要</p>',
        created_time: 1_700_000_000,
        question: { id: 37811449, title: '这是一个测试问题吗？' },
        author: { name: '测试用户' },
      },
    },
    {
      target: {
        type: 'article',
        id: 669214677,
        title: '测试专栏文章',
        excerpt: '文章摘要',
      },
    },
  ],
  paging: { is_end: false, next: 'https://www.zhihu.com/api/v3/feed/topstory/recommend?offset=20' },
})

assert.equal(result.articles.length, 2)
assert.deepEqual(result.articles[0]?.externalRef, {
  provider: 'zhihu-main',
  type: 'answer',
  id: '89226347214',
  parentId: '37811449',
})
assert.equal(result.articles[0]?.originUrl, 'https://www.zhihu.com/question/37811449/answer/89226347214')
assert.equal(result.articles[0]?.summary, '一段回答摘要')
assert.equal(result.articles[1]?.externalRef?.type, 'article')
assert.equal(result.paging?.isEnd, false)

console.log('✓ Zhihu signer and normalizer regression tests passed')
