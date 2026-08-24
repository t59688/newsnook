import assert from 'node:assert/strict'

import { buildClipboardText, buildShareText } from '../src/lib/shareArticle'

console.log('Testing article share text...')

// 1. 有出处时带上信源名，让转发出去的一行话能自解释
assert.equal(
  buildShareText({ title: '国产大模型价格战再起', sourceName: '少数派' }),
  '国产大模型价格战再起 · 少数派',
)

// 2. 没有信源名就只留标题
assert.equal(buildShareText({ title: '国产大模型价格战再起' }), '国产大模型价格战再起')

// 3. 空标题兜底，避免分享出一条空消息
assert.equal(buildShareText({ title: '   ' }), '一篇文章')

// 4. 链接交给系统的 url 字段；剪贴板降级时才需要拼进正文
assert.equal(
  buildClipboardText({
    title: '国产大模型价格战再起',
    sourceName: '少数派',
    url: 'https://example.com/a1',
  }),
  '国产大模型价格战再起 · 少数派\nhttps://example.com/a1',
)
assert.equal(buildClipboardText({ title: '没有原文地址' }), '没有原文地址')

console.log('Article share text tests: ALL PASSED')
