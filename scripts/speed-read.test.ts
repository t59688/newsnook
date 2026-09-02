import assert from 'node:assert/strict'

const { chunkArticleText, cleanMarkdown } = await import('../src/features/speedRead/service')
const { speedReadCacheKey } = await import('../src/features/speedRead/cache')
const {
  parseSpeedReadStored,
  serializeSpeedRead,
  speedReadBodyForExport,
} = await import('../src/features/speedRead/serialize')
const {
  extractStreamChatDelta,
  splitInlineThinking,
} = await import('../src/features/speedRead/streamChat')
const { hasSpeedReadableText, SPEED_READ_MIN_TEXT_CHARS } = await import('../src/features/speedRead/service')

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

const serialized = serializeSpeedRead({
  thinking: '先梳理结构',
  body: '## 有所闻\n\n核心判断',
})
assert.match(serialized, /<!-- speed-read-thinking-start -->/)
assert.equal(parseSpeedReadStored(serialized).thinking, '先梳理结构')
assert.equal(speedReadBodyForExport(serialized), '## 有所闻\n\n核心判断')
assert.equal(speedReadBodyForExport('## 纯正文'), '## 纯正文')

const inline = splitInlineThinking(`前缀 ${'<' + 'think>'}推理中${'<' + '/think>'}\n\n## 有所闻\n正文`)
assert.equal(inline.thinking, '推理中')
assert.match(inline.body, /## 有所闻/)

const delta = extractStreamChatDelta({
  choices: [{ delta: { content: '正文', reasoning_content: '思考' } }],
})
assert.equal(delta.content, '正文')
assert.equal(delta.reasoning, '思考')

assert.equal(hasSpeedReadableText('<video></video><p>' + '文'.repeat(SPEED_READ_MIN_TEXT_CHARS) + '</p>'), true)
assert.equal(hasSpeedReadableText('<video></video><p>仅视频导语</p>'), false)

console.log('speed read tests passed')
