import assert from 'node:assert/strict'

import { buildClipboardText, buildSharePayload, buildShareText } from '../src/lib/shareArticle'
import {
  SHARE_LINK_ORIGIN,
  buildShareUrl,
  resolveShareOrigin,
  sharePayloadFromArticle,
} from '../src/lib/shareLink'
import type { Article } from '../src/lib/types'

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

// 4b. 分享正文（text 字段）任何情况下不得混入 URL：
// WhatsApp 会把正文原样放进气泡，URL 只该出现在系统的 url 字段里一次
assert.ok(
  !/https?:\/\//.test(
    buildShareText({
      title: '国产大模型价格战再起',
      sourceName: '少数派',
      url: 'https://news.aizeek.com/a/abc123',
    }),
  ),
  'buildShareText 不得把链接拼进正文',
)

// 4c. 系统分享载荷：有链接时只给 title + url，绝不带 text。
// @capacitor/share 的 Android 端会把 text 与 url 拼成 EXTRA_TEXT = "text url"，
// 微信把这种消息当纯文本、不抓 OG，聊天里就出不了链接卡；
// EXTRA_TEXT 是一条裸 URL 时才按链接消息处理。
{
  const payload = buildSharePayload({
    title: '国产大模型价格战再起',
    sourceName: '少数派',
    url: 'https://news.aizeek.com/a/abc123',
  })
  assert.equal(payload.title, '国产大模型价格战再起')
  assert.equal(payload.url, 'https://news.aizeek.com/a/abc123')
  assert.equal(payload.text, undefined, '有链接时不得携带 text，否则微信当纯文本消息')
}

// 4d. 没有链接才退回纯文本分享；空标题同样兜底
{
  const payload = buildSharePayload({ title: '国产大模型价格战再起', sourceName: '少数派' })
  assert.equal(payload.url, undefined)
  assert.equal(payload.text, '国产大模型价格战再起 · 少数派')
  assert.equal(buildSharePayload({ title: '  ', url: 'https://example.com/a1' }).title, '分享文章')
}

// 5. 分享出去的主链接是站内短链：剪贴板兜底也不能退回出版社地址
const article: Article = {
  id: 'sspai:0xdeadbeef',
  title: '国产大模型价格战再起',
  summary: '几家厂商在同一周把推理价格压到接近成本线。',
  publishedAt: 1_756_000_000_000,
  hasRealDate: true,
  sourceId: 'sspai',
  sourceName: '少数派',
  sourceLabel: '少数派',
  sourceGroup: 'tech',
  originUrl: 'https://sspai.com/post/12345',
}
const shareUrl = buildShareUrl(sharePayloadFromArticle(article), { origin: SHARE_LINK_ORIGIN })
const clipboard = buildClipboardText({
  title: article.title,
  url: shareUrl,
  sourceName: article.sourceName,
})
assert.ok(clipboard.includes('news.aizeek.com/a/'))
assert.ok(!clipboard.includes('sspai.com'))

// 6. 无 window 的环境（原生壳、构建脚本）默认落到生产 host
assert.equal(resolveShareOrigin(), SHARE_LINK_ORIGIN)

console.log('Article share text tests: ALL PASSED')
