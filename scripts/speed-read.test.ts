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
const { SPEED_READ_SECTION_TITLES, SPEED_READ_COMMENT_KEYS } = await import(
  '../src/features/speedRead/sections'
)
const { parseSpeedReadMarkdown } = await import('../src/lib/speedReadShare/parse')

assert.deepEqual(SPEED_READ_COMMENT_KEYS, ['satire', 'structure', 'situation'])
assert.equal(SPEED_READ_SECTION_TITLES.satire, '讽世')
assert.equal(SPEED_READ_SECTION_TITLES.structure, '析世')
assert.equal(SPEED_READ_SECTION_TITLES.situation, '观世')

const full = parseSpeedReadMarkdown(`## 有所闻
核心判断一句。
## 讽世
把「改革」说成给旧家具换桌布。
## 析世
钱从补贴口进，风险从居民口袋出。
## 观世
饭桌上没人再问明年房租，只问还能否续签。
## 重点脉络
- 要点一
- 要点二
## 值得注意
- 数字未核实
`)
assert.equal(full.conclusion, '核心判断一句。')
assert.equal(full.satire, '把「改革」说成给旧家具换桌布。')
assert.equal(full.structure, '钱从补贴口进，风险从居民口袋出。')
assert.equal(full.situation, '饭桌上没人再问明年房租，只问还能否续签。')
assert.deepEqual(full.keyPoints, ['要点一', '要点二'])
assert.deepEqual(full.warnings, ['数字未核实'])

const legacy = parseSpeedReadMarkdown(`## 有所闻
旧结论
## 重点脉络
- 旧要点
## 值得注意
暂无额外需要注意的信息
`)
assert.equal(legacy.satire, '')
assert.equal(legacy.structure, '')
assert.equal(legacy.situation, '')
assert.equal(legacy.conclusion, '旧结论')
assert.deepEqual(legacy.keyPoints, ['旧要点'])

const placeholder = parseSpeedReadMarkdown(`## 有所闻
结论
## 讽世
暂无额外可评
## 析世
暂无额外可评
## 观世
暂无额外可评
## 重点脉络
- a
## 值得注意
- b
`)
assert.equal(placeholder.satire, '暂无额外可评')
assert.equal(placeholder.structure, '暂无额外可评')
assert.equal(placeholder.situation, '暂无额外可评')

const { buildSpeedReadSystemPrompt, buildSpeedReadChunkSystemPrompt } = await import(
  '../src/features/speedRead/service'
)
const { SPEED_READ_PROMPT_VERSION } = await import('../src/features/speedRead/cache')

assert.equal(SPEED_READ_PROMPT_VERSION, 'speed-read-v3')

const system = buildSpeedReadSystemPrompt()
assert.match(system, /## 有所闻/)
assert.match(system, /## 讽世/)
assert.match(system, /## 析世/)
assert.match(system, /## 观世/)
assert.match(system, /## 重点脉络/)
assert.match(system, /## 值得注意/)
assert.match(system, /Oscar Wilde/)
assert.match(system, /钱钟书/)
assert.match(system, /汪曾祺/)
assert.match(system, /20-40/)
assert.match(system, /暂无额外可评/)
assert.match(system, /同一轮|六个二级标题/)

const chunk = buildSpeedReadChunkSystemPrompt()
assert.match(chunk, /不要下全文结论/)
assert.doesNotMatch(chunk, /讽世/)
assert.doesNotMatch(chunk, /析世/)
assert.doesNotMatch(chunk, /观世/)

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
