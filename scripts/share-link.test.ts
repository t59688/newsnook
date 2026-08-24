import assert from 'node:assert/strict'

import {
  MAX_SHARE_TOKEN_LENGTH,
  SHARE_LINK_ORIGIN,
  SHARE_PATH_PREFIX,
  articleFromSharePayload,
  buildShareUrl,
  decodeShareToken,
  encodeShareToken,
  parseShareUrl,
  shareTokenFromPath,
  shareUrlDisplay,
  sharePayloadFromArticle,
} from '../src/lib/shareLink'
import type { Article } from '../src/lib/types'

console.log('Testing in-app share links...')

const article: Article = {
  id: 'sspai:0xdeadbeef',
  title: '国产大模型价格战再起',
  summary: '几家厂商在同一周把推理价格压到接近成本线，背后是模型效率的普遍提升。',
  publishedAt: 1_756_000_000_000,
  hasRealDate: true,
  sourceId: 'sspai',
  sourceName: '少数派',
  sourceLabel: '少数派',
  sourceGroup: 'tech',
  originUrl: 'https://sspai.com/post/12345',
}

// 1. 编解码往返：打开阅读器需要的字段一个都不能丢
const payload = sharePayloadFromArticle(article)
const decoded = decodeShareToken(encodeShareToken(payload))
assert.ok(decoded, '正常 token 应能解码')
assert.equal(decoded.id, article.id)
assert.equal(decoded.title, article.title)
assert.equal(decoded.originUrl, article.originUrl)
assert.equal(decoded.sourceId, article.sourceId)
assert.equal(decoded.sourceName, article.sourceName)
assert.equal(decoded.publishedAt, article.publishedAt)

// 2. 分享主链接指向站内，不是出版社原站
const url = buildShareUrl(payload, { origin: SHARE_LINK_ORIGIN })
assert.ok(url.startsWith(`${SHARE_LINK_ORIGIN}${SHARE_PATH_PREFIX}`), '主链接必须是站内短链')
assert.ok(!url.includes('sspai.com'), '主链接不得直接暴露原站地址')
assert.equal(new URL(url).hostname, 'news.aizeek.com')

// 3. 开发态可以指向本机 origin，路径结构保持一致
const devUrl = buildShareUrl(payload, { origin: 'http://192.168.1.8:5173/' })
assert.ok(devUrl.startsWith('http://192.168.1.8:5173/a/'), '开发态 origin 也走同一路径')

// 4. 反向解析：整条 URL 与单独的 pathname 都能还原
const fromUrl = parseShareUrl(url)
assert.equal(fromUrl?.title, article.title)
assert.equal(shareTokenFromPath(new URL(url).pathname), url.split(SHARE_PATH_PREFIX)[1])

// 5. 非分享路径不参与深链，避免误吞首页与设置栈
assert.equal(shareTokenFromPath('/'), null)
assert.equal(shareTokenFromPath('/about'), null)
assert.equal(shareTokenFromPath('/a/'), null)
assert.equal(shareTokenFromPath('/a/abc/def'), null)

// 6. 恶意与损坏 token 一律拒绝，不能抛异常打断冷启动
assert.equal(decodeShareToken(''), null)
assert.equal(decodeShareToken('not*base64url'), null)
assert.equal(decodeShareToken('YWJj'), null, '非 JSON 载荷应拒绝')
assert.equal(
  decodeShareToken(Buffer.from(JSON.stringify({ v: 99, i: 'a', t: 'b', u: 'https://a.com', s: 'c', n: 'd' })).toString('base64url')),
  null,
  '版本不匹配应拒绝',
)
assert.equal(
  decodeShareToken(
    Buffer.from(
      JSON.stringify({ v: 1, i: 'a', t: 'b', u: 'javascript:alert(1)', s: 'c', n: 'd' }),
    ).toString('base64url'),
  ),
  null,
  '非 http(s) 原文地址应拒绝',
)
assert.equal(
  decodeShareToken(
    Buffer.from(JSON.stringify({ v: 1, t: 'b', u: 'https://a.com', s: 'c', n: 'd' })).toString(
      'base64url',
    ),
  ),
  null,
  '缺少 id 应拒绝',
)
assert.equal(decodeShareToken('A'.repeat(MAX_SHARE_TOKEN_LENGTH + 1)), null, '超长 token 应拒绝')
assert.equal(
  decodeShareToken(
    Buffer.from(
      JSON.stringify({ v: 1, i: 'a', t: 'x'.repeat(400), u: 'https://a.com', s: 'c', n: 'd' }),
    ).toString('base64url'),
  ),
  null,
  '异常超长标题应拒绝',
)

// 7. 编码侧自己会裁剪，正常文章不会撞到长度上限
const longPayload = sharePayloadFromArticle({ ...article, title: '标'.repeat(400) })
assert.ok(longPayload.title.length <= 200)
assert.ok(decodeShareToken(encodeShareToken(longPayload)), '裁剪后的标题仍可解码')

// 8. 还原 Article：认识的信源用注册表元数据，不认识的退回链接里的信源名
const known = articleFromSharePayload(decoded)
assert.equal(known.sourceId, 'sspai')
assert.equal(known.originUrl, article.originUrl)
assert.equal(known.hasRealDate, true)

const unknown = articleFromSharePayload({
  id: 'x:1',
  title: '标题',
  originUrl: 'https://example.com/a',
  sourceId: 'not-registered',
  sourceName: '某站',
})
assert.equal(unknown.sourceName, '某站')
assert.equal(unknown.sourceGroup, 'custom')
assert.equal(unknown.hasRealDate, false)

// 9. 卡片上展示的短链去掉协议并省略过长尾巴
assert.equal(shareUrlDisplay('https://news.aizeek.com/a/abc', 60), 'news.aizeek.com/a/abc')
assert.ok(shareUrlDisplay(url, 24).endsWith('…'))
assert.equal(shareUrlDisplay(url, 24).length, 24)

console.log('In-app share link tests: ALL PASSED')
