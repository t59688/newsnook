/**
 * P0 财经源：CLS 签名、东财/见闻快讯解析、短讯正文可用。
 * 用法：npx tsx scripts/finance-sources.test.ts
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import { parseSourcePayload } from '../src/lib/parseFeed'
import { isInlineFlashBody, isSubstantialHtml } from '../src/lib/resolveBody'
import {
  clsSignedListUrl,
  findSource,
  maxOffsetPages,
  offsetPageRequest,
  pagingStrategyOf,
} from '../src/sources/registry'

function nodeClsSign(params: Record<string, string | number>): string {
  const filtered = Object.fromEntries(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null),
  )
  const search = new URLSearchParams(
    Object.entries(filtered).map(([k, v]) => [k, String(v)]),
  )
  search.sort()
  const sha1 = createHash('sha1').update(search.toString()).digest('hex')
  return createHash('md5').update(sha1).digest('hex')
}

// —— CLS 签名与列表 URL ——
const clsParams = {
  app: 'CailianpressWeb',
  last_time: 0,
  os: 'web',
  refresh_type: 1,
  rn: 20,
  sv: '8.7.9',
}
const expectedSign = nodeClsSign(clsParams)
const signed = clsSignedListUrl({ rn: 20, lastTime: 0 })
assert.match(signed, /^https:\/\/www\.cls\.cn\/v1\/roll\/get_roll_list\?/)
assert.match(signed, new RegExp(`sign=${expectedSign}`))

const cls = findSource('cls-telegraph')!
assert.ok(cls)
assert.equal(cls.kind, 'cls')
assert.ok(cls.userAgent?.includes('Windows NT') || cls.userAgent?.includes('Chrome/'))
const clsReq = offsetPageRequest(cls, 0)
assert.match(clsReq.url, /sign=/)
assert.match(clsReq.url, /rn=20/)

// —— 解析：财联社 ——
const clsPayload = JSON.stringify({
  data: {
    roll_data: [
      {
        id: 1001,
        brief: '【快讯标题】',
        content: '【快讯标题】市场消息称某公司拟回购股份。',
        ctime: 1720000000,
      },
    ],
  },
})
const clsArticles = parseSourcePayload(cls, clsPayload)
assert.equal(clsArticles.length, 1)
assert.equal(clsArticles[0].title.includes('快讯标题'), true)
assert.ok(clsArticles[0].contentHtml?.includes('回购'))
assert.ok(clsArticles[0].originUrl.includes('cls.cn'))
assert.equal(clsArticles[0].hasRealDate, true)
assert.equal(isInlineFlashBody(clsArticles[0].contentHtml, cls.id), true)
assert.equal(isSubstantialHtml(clsArticles[0].contentHtml), false)

// 收到移动 H5 劫持 HTML 时明确抛错
assert.throws(
  () => parseSourcePayload(cls, '<!DOCTYPE html><html><title>财联社</title></html>'),
  /财联社返回了 HTML 页面/,
)

// —— 解析：东方财富快讯 ——
const emKx = findSource('eastmoney-kx')!
assert.ok(emKx)
assert.equal(pagingStrategyOf(emKx), 'upstream-offset')
assert.ok(maxOffsetPages(emKx) > 1)
assert.match(offsetPageRequest(emKx, 0).url, /_ajaxResult_50_1_\.html/)
assert.match(offsetPageRequest(emKx, 2).url, /_ajaxResult_50_3_\.html/)
const emKxPayload =
  'var ajaxResult={"LivesList":[{"title":"创业板指翻红","digest":"【创业板指翻红】市场低开高走。","newsid":"202608063833617844","showtime":"2026-08-06 10:26:02"}]};'
const emKxArticles = parseSourcePayload(emKx, emKxPayload)
assert.equal(emKxArticles.length, 1)
assert.equal(emKxArticles[0].title, '创业板指翻红')
assert.ok(emKxArticles[0].contentHtml?.includes('低开高走'))
assert.ok(emKxArticles[0].originUrl.includes('202608063833617844'))
assert.equal(isInlineFlashBody(emKxArticles[0].contentHtml, emKx.id), true)

// —— 解析：东方财富专栏 ——
const emNews = findSource('eastmoney-news')!
assert.ok(emNews)
assert.equal(pagingStrategyOf(emNews), 'upstream-offset')
assert.ok(maxOffsetPages(emNews) > 1)
const emNewsReq = offsetPageRequest(emNews, 0)
assert.match(emNewsReq.url, /req_trace=/)
assert.match(emNewsReq.url, /page_index=1/)
assert.match(offsetPageRequest(emNews, 1).url, /page_index=2/)
const emNewsPayload = JSON.stringify({
  code: '1',
  data: {
    list: [
      {
        title: 'DeepSeek拟上调API服务定价',
        url: 'http://finance.eastmoney.com/news/1350,202608063833574771.html',
        summary: 'DeepSeek今日公告计划上调定价。',
        showTime: '2026-08-06 10:00:00',
      },
    ],
  },
})
const emNewsArticles = parseSourcePayload(emNews, emNewsPayload)
assert.equal(emNewsArticles.length, 1)
assert.equal(emNewsArticles[0].title.includes('DeepSeek'), true)
assert.ok(emNewsArticles[0].originUrl.includes('eastmoney.com'))
// 专栏列表只有摘要，不走 inline flash
assert.equal(isInlineFlashBody(emNewsArticles[0].contentHtml, emNews.id), false)

// —— 解析：华尔街见闻快讯 ——
const wscn = findSource('wscn-live')!
assert.ok(wscn)
const wscnPayload = JSON.stringify({
  data: {
    items: [
      {
        id: 555,
        title: '',
        content_text: '美股期货走低，科技股承压。',
        content: '<p>美股期货走低，科技股承压。</p>',
        display_time: 1720000100,
        uri: 'https://wallstreetcn.com/livenews/555',
      },
    ],
  },
})
const wscnArticles = parseSourcePayload(wscn, wscnPayload)
assert.equal(wscnArticles.length, 1)
assert.ok(wscnArticles[0].title.includes('美股期货') || wscnArticles[0].title.length > 0)
assert.ok(wscnArticles[0].contentHtml)
assert.equal(isInlineFlashBody(wscnArticles[0].contentHtml, wscn.id), true)

// —— BBC Business / 启用开关 ——
const bbcBiz = findSource('bbc-business')!
assert.ok(bbcBiz)
assert.equal(bbcBiz.kind, 'feed')
assert.equal(bbcBiz.enabled, true)
assert.equal(findSource('gnews-business')!.enabled, true)
assert.equal(findSource('netease-stock')!.enabled, true)

console.log('finance-sources: all ok')
