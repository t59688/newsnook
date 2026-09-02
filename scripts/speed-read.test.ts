import assert from 'node:assert/strict'

const { chunkArticleText, cleanMarkdown } = await import('../src/features/speedRead/service')
const { speedReadCacheKey } = await import('../src/features/speedRead/cache')
const {
  parseSpeedReadStored,
  serializeSpeedRead,
  speedReadBodyForExport,
} = await import('../src/features/speedRead/serialize')
const {
  createStreamUpdateScheduler,
  extractStreamChatDelta,
  splitInlineThinking,
  streamChatCompletion,
} = await import('../src/features/speedRead/streamChat')
const { awaitWithAbort } = await import('../src/features/speedRead/abortable')
const { createSpeedReadPartialStore, EMPTY_SPEED_READ_PARTIAL } = await import(
  '../src/features/speedRead/partialStore'
)
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

let scheduledRuns = 0
const scheduler = createStreamUpdateScheduler(() => {
  scheduledRuns += 1
}, 60_000)
scheduler.schedule()
for (let index = 0; index < 100; index += 1) scheduler.schedule()
assert.equal(scheduledRuns, 1)
scheduler.flush()
assert.equal(scheduledRuns, 2)
scheduler.schedule()
scheduler.cancel()
scheduler.flush()
assert.equal(scheduledRuns, 2)

const abortController = new AbortController()
let resolveNative: ((value: string) => void) | null = null
const nativePending = new Promise<string>((resolve) => {
  resolveNative = resolve
})
const aborted = awaitWithAbort(nativePending, abortController.signal)
abortController.abort()
await assert.rejects(aborted, (error: unknown) => error instanceof DOMException && error.name === 'AbortError')
resolveNative?.('late response')

const partialStore = createSpeedReadPartialStore()
const firstHiddenPartial = { thinking: '后台思考', body: '', status: '正在生成速读…' }
partialStore.set(firstHiddenPartial)
assert.deepEqual(partialStore.getSnapshot(), firstHiddenPartial, '无订阅者时仍保留最新进度')

let partialNotifications = 0
const unsubscribePartial = partialStore.subscribe(() => {
  partialNotifications += 1
})
partialStore.set(firstHiddenPartial)
assert.equal(partialNotifications, 0, '相同快照不重复广播')
partialStore.set({ thinking: '后台思考', body: '## 有所闻', status: '' })
assert.equal(partialNotifications, 1)
unsubscribePartial()
partialStore.set({ thinking: '已完成', body: '## 有所闻\n\n结论', status: '' })
assert.equal(partialNotifications, 1, '关闭面板退订后不触发渲染通知')
assert.equal(partialStore.getSnapshot().body, '## 有所闻\n\n结论', '重新打开时可同步恢复最新进度')
partialStore.reset()
assert.deepEqual(partialStore.getSnapshot(), EMPTY_SPEED_READ_PARTIAL)

const encoder = new TextEncoder()
const responseStream = new ReadableStream<Uint8Array>({
  start(controller) {
    controller.enqueue(
      encoder.encode('data: {"choices":[{"delta":{"content":"## 有所闻\\n\\n结论"}}]}\n\ndata: [DONE]\n\n'),
    )
    controller.close()
  },
})
const originalFetch = globalThis.fetch
globalThis.fetch = async () =>
  new Response(responseStream, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
  })
try {
  const streamed = await streamChatCompletion(
    'https://api.example.com/v1/chat/completions',
    'test-key',
    { model: 'test-model', stream: true },
    undefined,
    undefined,
  )
  assert.equal(streamed.body, '## 有所闻\n\n结论')
  assert.equal(responseStream.locked, false, '流完成后必须释放 reader lock')
} finally {
  globalThis.fetch = originalFetch
}

console.log('speed read tests passed')
