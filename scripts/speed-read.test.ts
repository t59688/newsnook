import assert from 'node:assert/strict'

const { chunkArticleText, cleanMarkdown } = await import('../src/features/speedRead/service')
const { speedReadCacheKey } = await import('../src/features/speedRead/cache')

assert.deepEqual(chunkArticleText('a\n\nb\n\nc', 4), ['a\n\nb', 'c'])
const long = 'abcdefghij'
assert.deepEqual(chunkArticleText(long, 4), ['abcd', 'efgh', 'ij'])
assert.equal(cleanMarkdown('```markdown\n## 结论\n内容\n```'), '## 结论\n内容')

const config = { endpoint: 'https://api.example.com/v1', model: 'model-a' }
const baselineKey = speedReadCacheKey('article-1', '标题', '<p>正文</p>', config)
assert.equal(baselineKey, speedReadCacheKey('article-1', '标题', '<p>正文</p>', config))
assert.notEqual(baselineKey, speedReadCacheKey('article-1', '新标题', '<p>正文</p>', config))
assert.notEqual(baselineKey, speedReadCacheKey('article-1', '标题', '<p>正文变化</p>', config))
assert.notEqual(
  baselineKey,
  speedReadCacheKey('article-1', '标题', '<p>正文</p>', { ...config, model: 'model-b' }),
)

console.log('speed read tests passed')
