/**
 * 公众号镜像（wechat2rss）与社区频道（优设 AIGC / 人人PM）专项测试：
 * 1. 注册表与分类覆盖 / 互斥自检
 * 2. 优设 tag 列表页解析器（卡片抽取、导航过滤、日期与配图）
 * 3. 优设 /page/N 翻页映射与分页策略
 * 4. wechat2rss 正文噪声清洗（meta 行 / 跳转微信打开 / mp-style-type）与全文判断
 *
 * 用法：npx tsx scripts/community-wechat-sources.test.ts
 */
import assert from 'node:assert/strict'

import { cleanWechat2rssContentHtml, parseSourcePayload } from '../src/lib/parseFeed'
import { isSubstantialHtml } from '../src/lib/resolveBody'
import { CATEGORIES, uncoveredSourceIds } from '../src/sources/categories'
import { duplicateSourcesAcrossCategories } from '../src/sources/presets'
import {
  findSource,
  maxOffsetPages,
  offsetPageRequest,
  pagingStrategyOf,
  WECHAT2RSS_BASE,
} from '../src/sources/registry'

// —— 1. 注册表与分类检查 ——
const WECHAT_MIRROR_IDS = ['xixiaoyao', 'paperweekly', '42zhangjing', 'chaping']
const COMMUNITY_IDS = ['uisdc-aigc', 'woshipm-ai']

for (const id of [...WECHAT_MIRROR_IDS, ...COMMUNITY_IDS]) {
  const src = findSource(id)
  assert.ok(src, `Source ${id} must be registered in SOURCES`)
  assert.ok(src.name && src.label, `Source ${id} must have name and label`)
  assert.ok(src.url.startsWith('https://'), `Source ${id} must use https`)
}

for (const id of WECHAT_MIRROR_IDS) {
  const src = findSource(id)!
  assert.equal(src.kind, 'wechat2rss', `${id} must use the wechat2rss kind`)
  assert.ok(
    src.url.startsWith(`${WECHAT2RSS_BASE}/feed/`),
    `${id} feed URL must come from WECHAT2RSS_BASE`,
  )
  // 第三方镜像默认关闭，由分类 / 预设按需启用
  assert.equal(src.enabled, false, `${id} must default to disabled`)
}

assert.equal(findSource('uisdc-aigc')!.kind, 'uisdc')
assert.equal(findSource('woshipm-ai')!.kind, 'feed')

const uncovered = uncoveredSourceIds()
assert.deepEqual(uncovered, [], `uncovered sources: ${uncovered.join(', ')}`)

const categoryDefaults: Record<string, string[]> = {}
for (const cat of CATEGORIES) {
  if (cat.sourceIds?.length) categoryDefaults[cat.id] = [...cat.sourceIds]
}
const dupes = duplicateSourcesAcrossCategories(categoryDefaults)
assert.deepEqual(dupes, [], `CATEGORIES must stay mutually exclusive, dupes: ${dupes.join(', ')}`)

const aiCategory = CATEGORIES.find((cat) => cat.id === 'ai')!
for (const id of ['xixiaoyao', 'paperweekly', '42zhangjing', 'uisdc-aigc', 'woshipm-ai']) {
  assert.ok(aiCategory.sourceIds!.includes(id), `${id} must be covered by the ai category`)
}
const techCategory = CATEGORIES.find((cat) => cat.id === 'tech')!
assert.ok(techCategory.sourceIds!.includes('chaping'), 'chaping must be covered by the tech category')

console.log('✓ wechat mirror & community sources registered, categories covered & exclusive')

// —— 2. 优设 tag 列表页解析 ——
const uisdcSource = findSource('uisdc-aigc')!
const uisdcFixture = `
<div class="category-list-item list-item-post f-item list-item-21 b"><div class="f-box c-box"><div class="item-wrap"><a class="item-thumb item-thumb-post" href="https://www.uisdc.com/seedance-2-5-5" target="_blank">
    <i class="thumb thumb-img thumb-pos-"><img alt="看完我实测的这5个案例，才知道Seedance 2.5有多强！" src="https://image.uisdc.com/wp-content/uploads/2026/08/ysbanner-20260817-1.webp"></i></a>
<div class="item-top-readlater use-vue"><div is="meta-read-later" pid="680739"></div></div><div class="item-main">
    <h2 class="item-title">
        <a title="看完我实测的这5个案例，才知道Seedance 2.5有多强！" href="https://www.uisdc.com/seedance-2-5-5" target="_blank">看完我实测的这5个案例，才知道Seedance 2.5有多强！</a>
    </h2>
    <h4 class="item-meta">
        <div class="meta-author">
            <i class="meta-time">
                2026/08/17            </i>
            <a class="u-info" href="https://www.uisdc.com/u/18192/publish/all" target="_blank" title="做设计的鹿野Loyel">
                <i class="avatar"><i class="thumb " style="background-image:url(https://image.uisdc.com/avatar.jpg);"></i></i><i class="u-name">做设计的鹿野Loyel</i>            </a>
        </div>
    </h4>
</div>
</div></div></div>
<div class="category-list-item list-item-group f-item list-item-22 b"><div class="f-box c-box"><div class="item-wrap"><a class="item-thumb item-thumb-group" href="https://www.uisdc.com/group/680665.html" target="_blank">
    <i class="thumb thumb-img thumb-pos-top"><img alt="9组饮料海报提示词夯爆了！" src="https://image.uisdc.com/wp-content/uploads/2026/08/Juice-Prompt-20260816-00.webp"></i></a>
<div class="item-main">
    <h2 class="item-title">
        <a title="9组饮料海报提示词夯爆了！" href="https://www.uisdc.com/group/680665.html" target="_blank">9组饮料海报提示词夯爆了！</a>
    </h2>
    <h4 class="item-meta"><div class="meta-author"><i class="meta-time">2026/08/16</i></div></h4>
</div>
</div></div></div>
<div class="item-wrap"><a class="item-thumb item-thumb-post" href="https://www.uisdc.com/ai-travel-planner" target="_blank"><img alt="相对日期卡" src="https://image.uisdc.com/relative.webp"></a>
<div class="item-main">
    <h2 class="item-title">
        <a title="相对日期卡" href="https://www.uisdc.com/ai-travel-planner" target="_blank">相对日期卡</a>
    </h2>
    <h4 class="item-meta"><div class="meta-author"><i class="meta-time">
                1小时前            </i></div></h4>
</div>
</div>
<div class="item-wrap">
<div class="item-main">
    <h2 class="item-title">
        <a title="AI绘画专题" href="https://www.uisdc.com/tag/ai%e7%bb%98%e7%94%bb" target="_blank">AI绘画专题</a>
    </h2>
</div>
</div>
<div class="item-wrap"><a class="item-thumb item-thumb-post" href="https://www.uisdc.com/seedance-2-5-5" target="_blank"><img src="https://image.uisdc.com/dup.webp"></a>
<div class="item-main">
    <h2 class="item-title">
        <a title="看完我实测的这5个案例，才知道Seedance 2.5有多强！" href="https://www.uisdc.com/seedance-2-5-5" target="_blank">看完我实测的这5个案例，才知道Seedance 2.5有多强！</a>
    </h2>
</div>
</div>
`

const uisdcArticles = parseSourcePayload(uisdcSource, uisdcFixture)
assert.equal(uisdcArticles.length, 3, 'should keep 3 article cards, skipping tag nav & duplicate')
assert.equal(uisdcArticles[0].title, '看完我实测的这5个案例，才知道Seedance 2.5有多强！')
assert.equal(uisdcArticles[0].originUrl, 'https://www.uisdc.com/seedance-2-5-5')
assert.equal(uisdcArticles[0].hasRealDate, true, 'meta-time date must be parsed as real date')
assert.equal(
  new Date(uisdcArticles[0].publishedAt).toISOString().slice(5, 10),
  '08-17',
  'publishedAt must match 2026/08/17',
)
assert.equal(
  uisdcArticles[0].image,
  'https://image.uisdc.com/wp-content/uploads/2026/08/ysbanner-20260817-1.webp',
)
assert.ok(uisdcArticles[0].summary.includes('做设计的鹿野Loyel'), 'author appears in summary')
assert.equal(uisdcArticles[1].originUrl, 'https://www.uisdc.com/group/680665.html')
assert.equal(uisdcArticles[1].hasRealDate, true)

// 「1小时前」相对日期须归一到抓取时刻前后 1 小时附近，而不是被 Date.parse 吞成 2001 年
const relativeCard = uisdcArticles[2]
assert.equal(relativeCard.originUrl, 'https://www.uisdc.com/ai-travel-planner')
assert.equal(relativeCard.hasRealDate, true)
const hourAgoDrift = Math.abs(Date.now() - 3_600_000 - relativeCard.publishedAt)
assert.ok(hourAgoDrift < 5 * 60_000, `relative date must resolve near now-1h, drift=${hourAgoDrift}ms`)

console.log('✓ uisdc tag listing parser verified (cards, nav filter, dates, cover)')

// —— 3. 优设翻页映射与分页策略 ——
assert.equal(pagingStrategyOf(uisdcSource), 'upstream-offset')
assert.ok(maxOffsetPages(uisdcSource) > 1)
assert.equal(offsetPageRequest(uisdcSource, 0).url, 'https://www.uisdc.com/tag/aigc')
assert.equal(offsetPageRequest(uisdcSource, 1).url, 'https://www.uisdc.com/tag/aigc/page/2')
assert.equal(offsetPageRequest(uisdcSource, 4).url, 'https://www.uisdc.com/tag/aigc/page/5')

// 公众号镜像是纯 RSS：一次目录 + 客户端窗口
for (const id of WECHAT_MIRROR_IDS) {
  assert.equal(pagingStrategyOf(findSource(id)!), 'client-catalog', id)
}

console.log('✓ uisdc /page/N offset paging & wechat2rss client-catalog verified')

// —— 4. wechat2rss 正文清洗与全文判断 ——
const body = Array.from(
  { length: 20 },
  (_, i) =>
    `<p>第 ${i + 1} 段：这是一段足够长的正文内容，用来验证公众号镜像 feed 自带全文可以直接作为站内正文渲染，而不需要回源抓取微信页面；镜像图片经 img-proxy 中转，正文文字则完整保留在 content:encoded 里。</p>`,
).join('')

const wechatFixture = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>夕小瑶科技说</title>
    <link>${WECHAT2RSS_BASE}/feed/test.xml</link>
    <item>
      <title>黄仁勋被曝当上 AI 圈“红娘”，算力大战突然换了玩法</title>
      <link>https://mp.weixin.qq.com/s?__biz=MzIwNzc2NTk0NQ==&amp;mid=2247619704&amp;idx=1&amp;sn=abc8c731767b0e3eb2f9d2f940574010</link>
      <description></description>
      <pubDate>Fri, 21 Aug 2026 08:36:00 +0800</pubDate>
      <content:encoded><![CDATA[<p>原创 <span>阿雅</span> <span>2026-08-21 08:36</span> <span style="display: inline-block;">北京</span></p>
<p><img src="${WECHAT2RSS_BASE}/img-proxy/?k=4938f3cd&amp;u=https%3A%2F%2Fmmbiz.qpic.cn%2Fcover.jpeg"/></p>
${body}
<p style="display: none;"><mp-style-type data-value="3"></mp-style-type></p>
<p><a href="${WECHAT2RSS_BASE}/link-proxy/?k=f8ff3542&amp;r=1&amp;u=https%3A%2F%2Fmp.weixin.qq.com%2Fs">跳转微信打开</a></p>]]></content:encoded>
    </item>
  </channel>
</rss>`

const wechatSource = findSource('xixiaoyao')!
const wechatArticles = parseSourcePayload(wechatSource, wechatFixture)
assert.equal(wechatArticles.length, 1)
const [wechatArticle] = wechatArticles
assert.equal(wechatArticle.title, '黄仁勋被曝当上 AI 圈“红娘”，算力大战突然换了玩法')
assert.equal(wechatArticle.hasRealDate, true)
assert.ok(wechatArticle.contentHtml, 'contentHtml must be kept from content:encoded')
assert.ok(!wechatArticle.contentHtml!.includes('跳转微信打开'), 'mirror tail link must be stripped')
assert.ok(!wechatArticle.contentHtml!.includes('mp-style-type'), 'mp-style-type must be stripped')
assert.ok(
  !/原创\s*阿雅/.test(wechatArticle.contentHtml!),
  'leading author/date meta line must be stripped',
)
assert.ok(wechatArticle.contentHtml!.includes('img-proxy'), 'image via mirror proxy must survive')
assert.ok(wechatArticle.summary.startsWith('第 1 段'), 'summary must start from real body text')
assert.ok(
  isSubstantialHtml(wechatArticle.contentHtml),
  'mirror full text must pass the substantial check (in-app reading without refetch)',
)

// 清洗器不得误伤：没有 meta 行的正文首段必须原样保留
const plain = '<p>这是一篇没有镜像模板噪声的正文首段。</p><p>第二段。</p>'
assert.equal(cleanWechat2rssContentHtml(plain), plain)

console.log('✓ wechat2rss boilerplate cleanup & fulltext check verified')

console.log('\nAll community & wechat mirror source tests passed!')
