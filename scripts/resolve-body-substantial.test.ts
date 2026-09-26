import assert from 'node:assert/strict'

import {
  CRAWLER_FALLBACK_UAS,
  aieraPostIdForTest,
  buildVideoBodyForTest,
  isBlockedPublisherHtml,
  isPartialFeedTeaser,
  isScrapeNoticeBody,
  isSubstantialHtml,
  parseAieraRestPostForTest,
  preferPublisherFetchUrl,
} from '../src/lib/resolveBody'
import type { Article } from '../src/lib/types'

const videoArticle: Article = {
  id: 'video-1',
  title: '现场直击',
  summary: '记者在发布会现场记录。',
  image: 'https://cdn.example/cover.jpg',
  publishedAt: 1,
  hasRealDate: true,
  sourceId: 'demo',
  sourceName: '示例',
  sourceLabel: '示例',
  sourceGroup: 'cn',
  originUrl: 'https://news.example/video/1',
  contentType: 'video',
}

assert.equal(
  isBlockedPublisherHtml('<html><title>Simple Page</title><body>akamai</body></html>'),
  true,
)
assert.equal(
  isBlockedPublisherHtml(
    '<html><body>Please enable JS and disable any ad blocker</body></html>',
  ),
  true,
)
assert.equal(
  isBlockedPublisherHtml(
    '<html><title>Google Translate</title><body>Can\'t translate this pageGo to original page</body></html>',
  ),
  true,
)
assert.equal(
  isBlockedPublisherHtml(
    '<html><title>Real Article</title><body><p>Walnuts are healthy nuts with omega-3.</p></body></html>',
  ),
  false,
)

/** 36kr 裸域反爬壳：无 title + 混淆脚本 + spinner */
assert.equal(
  isBlockedPublisherHtml(
    '<!DOCTYPE html><html><head><meta charset="UTF-8"/><style>.spinner{animation:spin 1s} @keyframes spin{} .x{background:conic-gradient(#165dff,#fff)}</style><script>function _0x4cb6(a,b){return a+b}</script></head><body><div class="spinner"></div></body></html>',
  ),
  true,
  '36kr 式 JS 挑战页应判为拦截',
)

assert.equal(
  preferPublisherFetchUrl('https://36kr.com/p/123?f=rss'),
  'https://www.36kr.com/p/123?f=rss',
)
assert.equal(
  preferPublisherFetchUrl('https://www.36kr.com/p/123'),
  'https://www.36kr.com/p/123',
)
assert.equal(
  preferPublisherFetchUrl('https://sspai.com/post/123'),
  'https://sspai.com/post/123',
)

/** Ars Technica 订阅源实际摘要：两段正文 + Read full article */
const arsTeaser = `<p><!-- obsidian --></p>
<p>Like any company, Reddit reports quarterly earnings, and its CEO, Steve Huffman, addresses investors during those reports. It's not always about just sharing numbers, though: This quarter, Huffman took the opportunity to voice concerns and criticisms about Google's AI Overviews feature, which automatically summarizes search results on most user queries.</p>
<p>First, there was a <a href="https://example.com/letter.pdf">letter to investors</a>, wherein Huffman spun his narrative about Reddit's value proposition and general strategic direction amid the proliferation of AI tools.</p>
<p><a href="https://arstechnica.com/ai/2026/08/reddit-ceo-on-ai-overviews-were-still-looking-for-that-win-win/">Read full article</a></p>
<p><a href="https://arstechnica.com/ai/2026/08/reddit-ceo-on-ai-overviews-were-still-looking-for-that-win-win/#comments">Comments</a></p>`

assert.equal(
  isSubstantialHtml(arsTeaser),
  false,
  'Ars 摘要含 Read full article，不应当作站内全文',
)
assert.equal(isPartialFeedTeaser(arsTeaser), true)

const vergeTeaser = `<p>SFB Games' The Mermaid Mask is a great murder mystery that builds on the foundation of Tangle Tower.</p>
<p>A submarine captain is found dead in a locked room. The list of suspects includes an author, an actor, an illusionist and a dream researcher. The submarine works as an excellen...</p>
<p><a href="https://www.theverge.com/example">Read the full story at The Verge.</a></p>`

assert.equal(
  isSubstantialHtml(vergeTeaser),
  false,
  'Verge 摘要含 Read the full story，不应当作站内全文',
)
assert.equal(isPartialFeedTeaser(vergeTeaser), true)

const shortTwoParagraphs = `<p>第一段内容只有一点点。</p><p>第二段也不长，总共远不够一篇文章。</p>`
assert.equal(
  isSubstantialHtml(shortTwoParagraphs),
  false,
  '仅有两个短段落不应仅凭 <p> 数量当作全文',
)
assert.equal(
  isPartialFeedTeaser(shortTwoParagraphs),
  false,
  '无 CTA 的短文不应仅因长度被标为 teaser 缓存淘汰',
)

const fullArticle = `<p>${'这是一段足够长的正文内容。'.repeat(20)}</p>
<p>${'第二段继续展开细节与背景。'.repeat(20)}</p>
<p>${'第三段给出结论与补充说明。'.repeat(20)}</p>
<p>${'第四段保证整体篇幅明显高于摘要阈值。'.repeat(20)}</p>`

assert.equal(
  isSubstantialHtml(fullArticle),
  true,
  '足够长的多段正文应视为订阅源全文',
)

assert.equal(isSubstantialHtml(undefined), false)
assert.equal(isSubstantialHtml(''), false)

/** NYT 对爬虫 UA 返回 200，正文位置只有这段版权声明 */
const nytScrapeNotice = `<div><p>Use of any device, tool, or process designed to data mine or scrape the content using automated means is prohibited without prior written permission from The New York Times Company. Prohibited uses include but are not limited to training machine learning models.</p><p>Contact Us for Content Packages and Rights Licensing for assistance.</p></div>`

assert.equal(
  isScrapeNoticeBody(nytScrapeNotice),
  true,
  'NYT 反爬声明不应被当作正文',
)
assert.equal(
  isScrapeNoticeBody(fullArticle),
  false,
  '正常正文不应被判为反爬声明',
)
assert.equal(
  isScrapeNoticeBody(
    `<p>${'关于数据抓取政策的深度报道正文。'.repeat(120)}</p><p>Use of any device, tool, or process designed to data mine or scrape the content is prohibited.</p>`,
  ),
  false,
  '正文足够长时页脚声明不应触发拦截判定',
)

assert.ok(
  CRAWLER_FALLBACK_UAS.some((ua) => ua.startsWith('facebookexternalhit')) &&
    CRAWLER_FALLBACK_UAS.some((ua) => ua.includes('Discordbot')),
  'UA 阶梯需覆盖 facebook（ESPN/Yahoo）与 Discordbot（Reuters）',
)

{
  const sniffing = buildVideoBodyForTest(videoArticle)
  assert.match(sniffing.contentHtml, /<video\b[^>]*data-media-pending="sniffing"/)
  assert.match(sniffing.contentHtml, /poster="https:\/\/cdn\.example\/cover\.jpg"/)
  assert.match(sniffing.contentHtml, /记者在发布会现场记录/)
  assert.doesNotMatch(
    sniffing.contentHtml,
    /本条为视频报道/,
    '视频稿应保留播放器占位，而不是改成说明文案',
  )
  const failed = buildVideoBodyForTest(videoArticle, 'failed')
  assert.match(failed.contentHtml, /data-media-pending="failed"/)
  const withUrl = buildVideoBodyForTest({
    ...videoArticle,
    videoUrl: 'https://cdn.example/full.mp4',
  })
  assert.doesNotMatch(
    withUrl.contentHtml,
    /<video\b/,
    '已有直链时由阅读器上方播放器承接，正文不再插占位 video',
  )
}

const aieraArticle: Article = {
  id: 'aiera-115517',
  title: '刚刚，GPT-6开真车考过了科目二！',
  summary: '新智元文章摘要',
  publishedAt: 1,
  hasRealDate: true,
  sourceId: 'aiera',
  sourceName: '新智元',
  sourceLabel: '新智元',
  sourceGroup: 'ai',
  originUrl: 'https://aiera.com.cn/asi-post.html?id=115517',
}

assert.equal(
  aieraPostIdForTest(aieraArticle),
  '115517',
  '新版 ASI 动态文章页应从 id 查询参数恢复 WordPress post id',
)
assert.equal(
  aieraPostIdForTest({
    ...aieraArticle,
    originUrl: 'https://aiera.com.cn/2026/09/legacy-post/',
  }),
  undefined,
  '旧版静态文章页继续走通用 Readability，不应误走 ASI REST 详情',
)
assert.equal(
  aieraPostIdForTest({ ...aieraArticle, sourceId: 'zhidx' }),
  undefined,
  'WordPress 详情兜底仅限新智元，不应影响其它 wordpress 源',
)

const aieraRestBody = parseAieraRestPostForTest(
  {
    id: 115517,
    title: { rendered: '刚刚，GPT-6开真车考过了科目二！' },
    content: {
      rendered: `<p>${'这是新智元正文内容，用于验证动态壳不会被当成文章正文。'.repeat(12)}</p>`,
    },
  },
  '115517',
)
assert.ok(aieraRestBody, '新智元 WP REST 单篇详情应产出正文')
assert.match(aieraRestBody.contentHtml, /新智元正文内容/)
assert.equal(aieraRestBody.title, '刚刚，GPT-6开真车考过了科目二！')
assert.equal(
  parseAieraRestPostForTest(
    {
      id: 115517,
      content: { rendered: '<p>正在取这篇稿子…</p>' },
    },
    '115517',
  ),
  null,
  '动态加载占位文案绝不能作为有效正文',
)
assert.equal(
  parseAieraRestPostForTest(
    {
      id: 115518,
      content: { rendered: `<p>${'另一篇完整正文。'.repeat(20)}</p>` },
    },
    '115517',
  ),
  null,
  'REST 返回的 post id 必须与文章 URL 一致',
)

console.log('resolve-body substantial tests passed')
