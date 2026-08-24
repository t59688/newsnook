import assert from 'node:assert/strict'

import { feedArticleId } from '../src/lib/articleId'
import {
  MAX_SHARE_TOKEN_LENGTH,
  SHARE_LINK_ORIGIN,
  SHARE_FALLBACK_TITLE,
  SHARE_PATH_PREFIX,
  SHARE_PENDING_TITLE,
  SHARE_TOKEN_TYPICAL_LIMIT,
  articleFromSharePayload,
  buildShareUrl,
  decodeShareToken,
  encodeShareToken,
  isPendingShareTitle,
  newShareSalt,
  parseShareUrl,
  shareTargetFromLocation,
  shareTokenFromPath,
  shareUrlDisplay,
  sharePayloadFromArticle,
  usableShareTitle,
  withResolvedShareTitle,
} from '../src/lib/shareLink'
import type { Article } from '../src/lib/types'

console.log('Testing in-app share links...')

const article: Article = {
  id: feedArticleId('sspai', 'https://sspai.com/post/12345'),
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

// 1. v2 往返：打开阅读器只需要原文地址与信源 id
const payload = sharePayloadFromArticle(article)
const token = encodeShareToken(payload)
const decoded = decodeShareToken(token)
assert.ok(decoded, '正常 token 应能解码')
assert.equal(decoded.originUrl, article.originUrl)
assert.equal(decoded.sourceId, article.sourceId)

// 2. 中文标题、摘要、信源名都不进 token
const plain = Buffer.from(token.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
assert.ok(!/[\u4e00-\u9fff]/.test(plain), 'v2 载荷里不应出现中文')
assert.ok(!plain.includes(article.title), '标题不得编进 token')
assert.ok(!plain.includes(article.summary), '摘要不得编进 token')
assert.ok(/^2\.[0-9a-z]{1,4}\n/.test(plain), 'v2 载荷第一行是版本号加校验位')

// 3. 长度上限：常见站点的分享 token 要留在一行放得下的范围内
const lengthCases: Array<{ label: string; article: Article }> = [
  {
    label: '网易新闻',
    article: {
      ...article,
      id: feedArticleId('netease-news', 'https://m.163.com/news/article/KJ8H2M9P0512B7QK.html'),
      title: '中国空间站完成第三次舱外作业，航天员在轨工作超过六小时',
      sourceId: 'netease-news',
      originUrl: 'https://m.163.com/news/article/KJ8H2M9P0512B7QK.html',
    },
  },
  {
    label: '微信公众号',
    article: {
      ...article,
      id: feedArticleId('wechat-renwu', 'https://mp.weixin.qq.com/s/AbCdEfGhIjKlMnOpQrStUv'),
      title: '一位县城中学老师的十年：把三千个孩子送出大山',
      sourceId: 'wechat-renwu',
      originUrl: 'https://mp.weixin.qq.com/s/AbCdEfGhIjKlMnOpQrStUv',
    },
  },
  { label: '少数派', article },
]

for (const item of lengthCases) {
  const size = encodeShareToken(sharePayloadFromArticle(item.article)).length
  assert.ok(
    size <= SHARE_TOKEN_TYPICAL_LIMIT,
    `${item.label} 的 v2 token 应不超过 ${SHARE_TOKEN_TYPICAL_LIMIT} 字符，实际 ${size}`,
  )
}

// 4. 能算出来的 id 不进 token；算不出来的才带，且去掉冗余的 sourceId 前缀
assert.ok(!plain.includes(article.id), '可推导的 id 不该写进 token')
const customIdPayload = sharePayloadFromArticle({ ...article, id: 'sspai:post-12345' })
const customIdDecoded = decodeShareToken(encodeShareToken(customIdPayload))
assert.equal(customIdDecoded?.id, 'sspai:post-12345', '不可推导的 id 要原样带回来')
const longIdDecoded = decodeShareToken(
  encodeShareToken(sharePayloadFromArticle({ ...article, id: `sspai:${'x'.repeat(80)}` })),
)
assert.equal(longIdDecoded?.id, undefined, '过长的 id 宁可丢掉，由接收端自己算')

// 5. 分享主链接指向站内，不是出版社原站
const url = buildShareUrl(payload, { origin: SHARE_LINK_ORIGIN })
assert.ok(url.startsWith(`${SHARE_LINK_ORIGIN}${SHARE_PATH_PREFIX}`), '主链接必须是站内短链')
assert.ok(!url.includes('sspai.com'), '主链接不得直接暴露原站地址')
assert.equal(new URL(url).hostname, 'news.aizeek.com')

// 6. 开发态可以指向本机 origin，路径结构保持一致
const devUrl = buildShareUrl(payload, { origin: 'http://192.168.1.8:5173/' })
assert.ok(devUrl.startsWith('http://192.168.1.8:5173/a/'), '开发态 origin 也走同一路径')

// 7. 反向解析：整条 URL 与单独的 pathname 都能还原
assert.equal(parseShareUrl(url)?.originUrl, article.originUrl)
assert.equal(shareTokenFromPath(new URL(url).pathname), url.split(SHARE_PATH_PREFIX)[1])

// 8. 非分享路径不参与深链，避免误吞首页与设置栈
assert.equal(shareTokenFromPath('/'), null)
assert.equal(shareTokenFromPath('/about'), null)
assert.equal(shareTokenFromPath('/a/'), null)
assert.equal(shareTokenFromPath('/a/abc/def'), null)

// 8b. 冷启动入口：合法深链解出 payload，普通访问是 undefined，损坏 token 是 null
assert.equal(shareTargetFromLocation('/'), undefined, '首页不是深链')
assert.equal(shareTargetFromLocation('/about'), undefined)
const landed = shareTargetFromLocation(`${SHARE_PATH_PREFIX}${token}`)
assert.ok(landed, '合法 /a/<token> 应解出 payload')
assert.equal(landed.originUrl, article.originUrl)
assert.equal(landed.sourceId, article.sourceId)
const landedArticle = articleFromSharePayload(landed)
assert.equal(landedArticle.originUrl, article.originUrl, '落地文章应指向同一原文')
assert.equal(landedArticle.sourceId, 'sspai')
assert.equal(
  shareTargetFromLocation(`${SHARE_PATH_PREFIX}broken*token`),
  null,
  '损坏 token 应返回 null（首页 + 中文错误提示）',
)

// 8c. 卡片页逃生门 ?app=1 只是 query，不影响 pathname 上 token 的解码
assert.equal(parseShareUrl(`${url}?app=1`)?.originUrl, article.originUrl)
assert.equal(parseShareUrl(`${url}?app=1#frag`)?.sourceId, article.sourceId)

// 9. 恶意与损坏 token 一律拒绝，不能抛异常打断冷启动
assert.equal(decodeShareToken(''), null)
assert.equal(decodeShareToken('not*base64url'), null)
assert.equal(decodeShareToken('YWJj'), null, '既非 v2 行格式也非 JSON 的载荷应拒绝')
assert.equal(decodeShareToken(token.slice(0, token.length - 12)), null, '被截断的 token 应拒绝')
assert.equal(
  decodeShareToken(`${token.slice(0, token.length - 4)}AAAA`),
  null,
  '尾部被改写的 token 应拒绝',
)

/** 按 v2 线格式手搓一个 token，用来验证校验位之外的字段校验 */
function v2Token(body: string): string {
  const sum = ((): string => {
    let hash = 5381
    for (let i = 0; i < body.length; i += 1) hash = ((hash << 5) + hash + body.charCodeAt(i)) >>> 0
    return hash.toString(36).slice(0, 4)
  })()
  return Buffer.from(`2.${sum}\n${body}`).toString('base64url')
}
assert.ok(decodeShareToken(v2Token('sspai\nsspai.com/post/1')), '手搓的合法 v2 token 应能解码')
assert.equal(decodeShareToken(v2Token('sspai\n')), null, 'v2 缺原文地址应拒绝')
assert.equal(decodeShareToken(v2Token('\nsspai.com/post/1')), null, 'v2 缺信源 id 应拒绝')
assert.equal(
  decodeShareToken(v2Token('sspai\njavascript:alert(1)')),
  null,
  '非 http(s) 原文地址应拒绝',
)
assert.equal(decodeShareToken('A'.repeat(MAX_SHARE_TOKEN_LENGTH + 1)), null, '超长 token 应拒绝')

// 9b. salt：再次分享换新 URL 打破平台预览缓存，接收端解码时忽略
const saltedToken = encodeShareToken(payload, { salt: 'ab12' })
assert.notEqual(saltedToken, token, '带 salt 的 token 应是另一条 URL')
const saltedPlain = Buffer.from(
  saltedToken.replace(/-/g, '+').replace(/_/g, '/'),
  'base64',
).toString('utf8')
assert.ok(saltedPlain.includes('\n~ab12'), 'salt 以 ~ 行编进载荷')
const saltedDecoded = decodeShareToken(saltedToken)
assert.ok(saltedDecoded, '带 salt 的 token 应能解码')
assert.equal(saltedDecoded.originUrl, article.originUrl, 'salt 不改变打开的文章')
assert.equal(saltedDecoded.sourceId, article.sourceId)
assert.equal(saltedDecoded.id, undefined, 'salt 行不得被误认成 id')
assert.equal(
  articleFromSharePayload(saltedDecoded).id,
  article.id,
  '带 salt 的链接算出的文章 id 与列表侧一致，已读/缓存/稍后读都对得上',
)

// salt 与 inline id 共存：id 仍还原，salt 仍被忽略
const saltedWithId = decodeShareToken(
  encodeShareToken({ ...payload, id: 'sspai:post-12345' }, { salt: 'zz99' }),
)
assert.equal(saltedWithId?.id, 'sspai:post-12345', 'salt 不影响 inline id 的还原')

// salt 参与校验位：改动 salt 而不重算校验的 token 应被拒绝
{
  const text = Buffer.from(saltedToken.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(
    'utf8',
  )
  const tampered = Buffer.from(text.replace('~ab12', '~cd34')).toString('base64url')
  assert.equal(decodeShareToken(tampered), null, '篡改 salt 而不重算校验位应被拒绝')
}

// 不合规 salt（超长 / 非 base36）直接丢掉，token 与不带 salt 时一致
assert.equal(encodeShareToken(payload, { salt: 'UPPER!' }), token)
assert.equal(encodeShareToken(payload, { salt: 'a'.repeat(20) }), token)
assert.equal(encodeShareToken(payload, {}), token)

// newShareSalt 生成 4 位 base36，随机换 URL 用
const salts = new Set(Array.from({ length: 8 }, () => newShareSalt()))
for (const salt of salts) assert.match(salt, /^[0-9a-z]{4}$/)
assert.ok(salts.size > 1, '多次生成的 salt 不应全部相同')

// buildShareUrl 带 salt：URL 变了，parseShareUrl 仍解出同一篇
const saltedUrl = buildShareUrl(payload, { origin: SHARE_LINK_ORIGIN, salt: newShareSalt() })
assert.notEqual(saltedUrl, url, '带 salt 的分享 URL 应不同')
assert.equal(parseShareUrl(saltedUrl)?.originUrl, article.originUrl)

// 带 salt 的 token 长度仍在一行放得下的范围内
for (const item of lengthCases) {
  const size = encodeShareToken(sharePayloadFromArticle(item.article), { salt: 'zzzz' }).length
  assert.ok(
    size <= SHARE_TOKEN_TYPICAL_LIMIT,
    `${item.label} 带 salt 的 token 应不超过 ${SHARE_TOKEN_TYPICAL_LIMIT} 字符，实际 ${size}`,
  )
}

// 手搓 v2：'~' 行出现在 id 槽位时按 salt 忽略，不当成 id
assert.equal(decodeShareToken(v2Token('sspai\nsspai.com/post/1\n~zzzz'))?.id, undefined)

// 10. v2 明文省掉 https:// 前缀，解码时补回；http 链接原样保留
assert.ok(plain.includes('sspai.com/post/12345'))
assert.ok(!plain.includes('https://'), 'https 前缀应被省掉')
assert.equal(
  decodeShareToken(encodeShareToken({ originUrl: 'http://example.com/a', sourceId: 'x' }))
    ?.originUrl,
  'http://example.com/a',
  'http 链接不应被改写成 https',
)

// 11. v1 旧链接仍然可用（含标题、摘要、时间）
const legacyToken = Buffer.from(
  JSON.stringify({
    v: 1,
    i: 'sspai:legacy',
    t: '国产大模型价格战再起',
    u: 'https://sspai.com/post/12345',
    s: 'sspai',
    n: '少数派',
    d: '旧链接摘要',
    p: 1_756_000_000_000,
  }),
).toString('base64url')
const legacy = decodeShareToken(legacyToken)
assert.ok(legacy, 'v1 token 仍应能解码')
assert.equal(legacy.id, 'sspai:legacy')
assert.equal(legacy.title, '国产大模型价格战再起')
assert.equal(legacy.summary, '旧链接摘要')
assert.equal(legacy.publishedAt, 1_756_000_000_000)
assert.equal(
  decodeShareToken(
    Buffer.from(JSON.stringify({ v: 99, i: 'a', t: 'b', u: 'https://a.com', s: 'c' })).toString(
      'base64url',
    ),
  ),
  null,
  '未知版本应拒绝',
)

// 12. 还原 Article：v2 没有标题时先占位，id 与列表侧算法保持一致
const opened = articleFromSharePayload(decoded)
assert.equal(opened.sourceId, 'sspai')
assert.equal(opened.originUrl, article.originUrl)
assert.equal(opened.id, article.id, '省掉 id 时接收端应算出与列表侧相同的 id')
assert.equal(opened.title, SHARE_PENDING_TITLE)
assert.equal(opened.hasRealDate, false)
assert.ok(isPendingShareTitle(opened.title))

const fromLegacy = articleFromSharePayload(legacy)
assert.equal(fromLegacy.title, '国产大模型价格战再起')
assert.equal(fromLegacy.hasRealDate, true)

const unknown = articleFromSharePayload({
  originUrl: 'https://example.com/a',
  sourceId: 'not-registered',
  sourceName: '某站',
})
assert.equal(unknown.sourceName, '某站')
assert.equal(unknown.sourceGroup, 'custom')
assert.equal(
  articleFromSharePayload({ originUrl: 'https://example.com/a', sourceId: 'not-registered' })
    .sourceName,
  '分享来源',
)

// 13. 正文抽取补回真标题后才落盘；已有真标题的文章不被覆盖
assert.equal(withResolvedShareTitle(opened, '真标题').title, '真标题')
assert.equal(withResolvedShareTitle(opened, '   ').title, SHARE_PENDING_TITLE)
assert.equal(withResolvedShareTitle(article, '别的标题').title, article.title)

// 14. 缓存里的占位标题不该被当成真标题再回填一遍
assert.equal(usableShareTitle('真标题'), '真标题')
assert.equal(usableShareTitle(SHARE_PENDING_TITLE), undefined)
assert.equal(usableShareTitle(SHARE_FALLBACK_TITLE), undefined)
assert.equal(usableShareTitle('  '), undefined)
assert.equal(usableShareTitle(undefined), undefined)

// 15. 卡片上展示的短链去掉协议并省略过长尾巴
assert.equal(shareUrlDisplay('https://news.aizeek.com/a/abc', 60), 'news.aizeek.com/a/abc')
assert.ok(shareUrlDisplay(url, 24).endsWith('…'))
assert.equal(shareUrlDisplay(url, 24).length, 24)

console.log('In-app share link tests: ALL PASSED')
