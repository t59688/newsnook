/**
 * 公众号解析器（kind `wechat`）与社区频道（优设 AIGC / 人人PM）专项测试：
 * 1. 注册表与分类覆盖 / 互斥自检（含 wechat2rss → wechat 兼容别名）
 * 2. 优设 tag 列表页解析器（卡片抽取、导航过滤、日期与配图）
 * 3. 优设 /page/N 翻页映射与分页策略
 * 4. 公众号镜像 feed 噪声清洗（meta 行 / 跳转微信打开 / mp-style-type）与全文判断
 * 5. 优设详情正文（group 图集 / 长文避开 uisdc-none + 阅读文章卡片）
 * 6. 公众号公开合集 JSON 列表解析（appmsgalbum）与合集链接归一
 * 7. 公众号文章页正文抽取（js_content / data-src / 验证壳拒收）
 *
 * 用法：npx tsx scripts/community-wechat-sources.test.ts
 */
import assert from 'node:assert/strict'

import { cleanWechatArticleHtml, parseSourcePayload } from '../src/lib/parseFeed'
import {
  extractUisdcBodyHtml,
  extractWechatArticleTitle,
  extractWechatBodyHtml,
  isBlockedPublisherHtml,
  isSubstantialHtml,
  isWechatArticleUrl,
} from '../src/lib/resolveBody'
import { sanitizeArticleHtml } from '../src/lib/sanitize'
import { CATEGORIES, uncoveredSourceIds } from '../src/sources/categories'
import { DEFAULT_PREFERENCES, addCustomSource } from '../src/sources/preferences'
import { duplicateSourcesAcrossCategories } from '../src/sources/presets'
import {
  findSource,
  isWechatAlbumUrl,
  maxOffsetPages,
  normalizeSourceKind,
  normalizeWechatAlbumUrl,
  offsetPageRequest,
  pagingStrategyOf,
  WECHAT2RSS_BASE,
} from '../src/sources/registry'

// —— 1. 注册表与分类检查 ——
// 二轮甄选后仅保留 3 个真·深度公众号；差评（chaping）已移除，见 docs/news-sources.md §5
const WECHAT_ACCOUNT_IDS = ['xixiaoyao', 'paperweekly', '42zhangjing']
const COMMUNITY_IDS = ['uisdc-aigc', 'woshipm-ai']

assert.equal(
  findSource('chaping'),
  undefined,
  'chaping was removed in the curation round and must stay unregistered',
)

for (const id of [...WECHAT_ACCOUNT_IDS, ...COMMUNITY_IDS]) {
  const src = findSource(id)
  assert.ok(src, `Source ${id} must be registered in SOURCES`)
  assert.ok(src.name && src.label, `Source ${id} must have name and label`)
  assert.ok(src.url.startsWith('https://'), `Source ${id} must use https`)
}

for (const id of WECHAT_ACCOUNT_IDS) {
  const src = findSource(id)!
  assert.equal(src.kind, 'wechat', `${id} must use the wechat kind (公众号解析器)`)
  assert.ok(
    src.url.startsWith(`${WECHAT2RSS_BASE}/feed/`),
    `${id} transitional list URL must come from WECHAT2RSS_BASE`,
  )
  // 第三方镜像默认关闭，由分类 / 预设按需启用
  assert.equal(src.enabled, false, `${id} must default to disabled`)
}

// 旧自建源 / 备份里的 wechat2rss kind 必须归一到公众号解析器
assert.equal(normalizeSourceKind('wechat2rss'), 'wechat')
assert.equal(normalizeSourceKind('wechat'), 'wechat')

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

// 公众号镜像归「深读」；优设 / 人人 PM / PaperWeekly 归「社区」
const aiDepthCategory = CATEGORIES.find((cat) => cat.id === 'ai-depth')!
for (const id of ['xixiaoyao', '42zhangjing']) {
  assert.ok(aiDepthCategory.sourceIds!.includes(id), `${id} must be covered by ai-depth`)
}
const aiCommunityCategory = CATEGORIES.find((cat) => cat.id === 'ai-community')!
for (const id of ['uisdc-aigc', 'woshipm-ai', 'paperweekly', 'v2ex', 'hn']) {
  assert.ok(aiCommunityCategory.sourceIds!.includes(id), `${id} must be covered by ai-community`)
}
assert.equal(aiCommunityCategory.sourceIds![0], 'uisdc-aigc', 'uisdc-aigc must lead the community category')
const aiCategory = CATEGORIES.find((cat) => cat.id === 'ai')!
for (const id of ['xixiaoyao', 'paperweekly', '42zhangjing', 'uisdc-aigc', 'woshipm-ai']) {
  assert.ok(!aiCategory.sourceIds!.includes(id), `${id} must not leak into the official ai category`)
}

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
{
  const d = new Date(uisdcArticles[0].publishedAt)
  assert.equal(
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    '2026-08-17',
    'publishedAt must match 2026/08/17 in local calendar',
  )
}
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

// 公众号列表是一次目录 + 客户端窗口
for (const id of WECHAT_ACCOUNT_IDS) {
  assert.equal(pagingStrategyOf(findSource(id)!), 'client-catalog', id)
}

console.log('✓ uisdc /page/N offset paging & wechat client-catalog verified')

// —— 4. 公众号镜像 feed 正文清洗与全文判断 ——
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
assert.equal(cleanWechatArticleHtml(plain), plain)

console.log('✓ wechat mirror feed boilerplate cleanup & fulltext check verified')

// —— 5. 优设详情正文：避开 Readability 的 uisdc-none / 图集兄弟节点坑 ——
const groupDetailFixture = `
<div class="group-singular-entry b"><div class="b-wrap"><div class="entry"><p>提示词：上下各占 50%，莫兰迪手绘风格。</p></div>
<div class="tags"><a class="tag-i">AIGC</a></div></div></div>
<div class="group-singular-images b"><div class="b-wrap flex">
  <div class="f-item"><i class="img-item-wrap" data-src="https://image.uisdc.com/a.webp"><img src="https://image.uisdc.com/a.webp" alt="图1"></i></div>
  <div class="f-item"><i class="img-item-wrap" data-src="https://image.uisdc.com/b.webp"><img src="https://image.uisdc.com/b.webp" alt="图2"></i></div>
  <div class="f-item"><i class="img-item-wrap" data-src="https://image.uisdc.com/c.webp"><img src="https://image.uisdc.com/c.webp" alt="图3"></i></div>
</div></div>
`
const groupBody = extractUisdcBodyHtml(groupDetailFixture)!
assert.ok(groupBody.includes('提示词'), 'group body keeps prompt text')
assert.equal((groupBody.match(/<img\b/gi) || []).length, 3, 'group body keeps all gallery images')

const postDetailFixture = `
<div class="post-content-wrap">
  <div class="post-article uisdc-none"><div class="article">
    <p><img src="https://image.uisdc.com/hero.webp" alt="封面"></p>
    <p>大家好，这次整理了一套 Vibe Coding 网站全栈作品集教程～</p>
    <p><div class="tuwen_link"><a href="https://www.uisdc.com/codex-in-action"><h2>22个实战案例</h2><span>阅读文章 &gt;</span></a></div></p>
    <p><img src="https://image.uisdc.com/step-1.webp" alt="步骤1"></p>
    <p><img src="https://image.uisdc.com/step-2.webp" alt="步骤2"></p>
  </div></div>
</div>
`
const postBody = extractUisdcBodyHtml(postDetailFixture)!
assert.ok(postBody.includes('Vibe Coding'), 'post body keeps intro')
assert.ok(!postBody.includes('阅读文章'), 'post body strips related-article card')
assert.ok(!postBody.includes('tuwen_link'), 'post body strips tuwen_link wrapper')
assert.equal((postBody.match(/<img\b/gi) || []).length, 3, 'post body keeps hero + steps')

{
  const withZoom = `
<div class="post-content-wrap"><div class="post-article uisdc-none"><div class="article">
  <p><span class="img-zoom"><img src="https://image.uisdc.com/hero.webp" alt="封面"></span></p>
  <p>大家好，教程正文。</p>
  <p>Codex 的使用方式：</p>
  <p><span class="img-zoom"><img src="https://image.uisdc.com/step.webp" alt="步骤"></span></p>
</div></div></div>`
  const extractedZoom = extractUisdcBodyHtml(withZoom)!
  const sanitizedZoom = sanitizeArticleHtml(extractedZoom)
  assert.equal(
    (sanitizedZoom.match(/<img\b/gi) || []).length,
    2,
    'sanitize must keep img-zoom wrapped images',
  )
}

console.log('✓ uisdc detail body extractor keeps group gallery & post images')

// —— 6. 公众号公开合集 JSON 列表（appmsgalbum 直连入口）——
const albumShareUrl =
  'https://mp.weixin.qq.com/mp/appmsgalbum?__biz=MzA3MDM3NjE5NQ==&action=getalbum&album_id=1375870284640911361&scene=173&from_msgid=2247487974&from_itemidx=1&count=3&nolastread=1#wechat_redirect'
assert.equal(isWechatAlbumUrl(albumShareUrl), true)
assert.equal(isWechatAlbumUrl('https://mp.weixin.qq.com/s/AbCdEf'), false)
assert.equal(isWechatAlbumUrl('https://example.com/mp/appmsgalbum?__biz=x&album_id=1'), false)

const albumListUrl = normalizeWechatAlbumUrl(albumShareUrl)
{
  const parsed = new URL(albumListUrl)
  assert.equal(parsed.hostname, 'mp.weixin.qq.com')
  assert.equal(parsed.pathname, '/mp/appmsgalbum')
  assert.equal(parsed.searchParams.get('f'), 'json', 'list URL must request JSON payload')
  assert.equal(parsed.searchParams.get('__biz'), 'MzA3MDM3NjE5NQ==')
  assert.equal(parsed.searchParams.get('album_id'), '1375870284640911361')
  assert.ok(!albumListUrl.includes('#'), 'share fragment must be dropped')
  assert.ok(!parsed.searchParams.get('scene'), 'share tracking params must be dropped')
}
// biz 简写参数（RSSHub 风格链接）同样可识别
assert.equal(
  isWechatAlbumUrl('https://mp.weixin.qq.com/mp/appmsgalbum?biz=MzA3MDM3NjE5NQ==&action=getalbum&album_id=1375870284640911361'),
  true,
)

// 字段名与线上响应一致（2026-08-25 实测 getalbum_resp 形态）
const albumFixture = JSON.stringify({
  base_resp: { exportkey_token: '', ret: 0 },
  getalbum_resp: {
    article_list: [
      {
        cover_img_1_1: 'http://mmbiz.qpic.cn/mmbiz_jpg/cover-a/300',
        create_time: '1755750000',
        itemidx: '1',
        msgid: '2650941860',
        pos_num: '96',
        title: '合集第一篇：深度长文',
        url: 'http://mp.weixin.qq.com/s?__biz=MzA3MDM3NjE5NQ==&mid=2650941860&idx=1&sn=6c1da71ee86b9b5a46d053b6f76861d4#rd',
      },
      {
        create_time: '1755660000',
        title: '合集第二篇：无封面也可入列',
        url: 'https://mp.weixin.qq.com/s?__biz=MzA3MDM3NjE5NQ==&mid=2650941800&idx=1&sn=abcdef0123456789abcdef0123456789',
      },
      { title: '缺链接的脏数据必须被跳过' },
    ],
    base_info: { article_count: '96' },
    continue_flag: '1',
  },
})

const albumSource = {
  id: 'custom_wechatalbum',
  name: '看理想 · 李厚辰专栏',
  label: '看理想',
  group: 'custom' as const,
  kind: 'wechat' as const,
  url: albumListUrl,
  enabled: true,
}
const albumArticles = parseSourcePayload(albumSource, albumFixture)
assert.equal(albumArticles.length, 2, 'dirty rows without link must be skipped')
assert.equal(albumArticles[0].title, '合集第一篇：深度长文')
assert.ok(
  albumArticles[0].originUrl.startsWith('https://mp.weixin.qq.com/s?__biz='),
  'album item url must be https-upgraded',
)
assert.equal(albumArticles[0].hasRealDate, true, 'create_time (unix seconds) must be parsed')
assert.equal(albumArticles[0].publishedAt, 1755750000 * 1000)
assert.equal(
  albumArticles[0].image,
  'https://mmbiz.qpic.cn/mmbiz_jpg/cover-a/300',
  'cover_img_1_1 must be https-upgraded as cover',
)
assert.equal(albumArticles[0].contentHtml, undefined, 'album list carries no body; reader resolves it')
assert.equal(albumArticles[1].image, undefined)

// ret 非 0（参数错误 / 合集不可见）与非 JSON 均安全返回空列表
assert.deepEqual(
  parseSourcePayload(albumSource, JSON.stringify({ base_resp: { ret: 10004 } })),
  [],
)
assert.deepEqual(parseSourcePayload(albumSource, '{ not json'), [])

// 自定义源粘贴合集分享链接：kind 识别为 wechat，URL 归一为 JSON 列表入口
{
  const { nextPrefs, newSourceId } = addCustomSource(DEFAULT_PREFERENCES, {
    name: '看理想 · 李厚辰专栏',
    url: albumShareUrl,
  })
  const added = nextPrefs.customSources?.find((s) => s.id === newSourceId)
  assert.ok(added, 'custom album source must be added')
  assert.equal(added.kind, 'wechat')
  assert.equal(added.url, albumListUrl)
}

console.log('✓ wechat album JSON listing & custom album source detection verified')

// —— 7. 公众号文章页正文抽取 ——
assert.equal(isWechatArticleUrl('https://mp.weixin.qq.com/s/d8fJvLQ4o7wjr_4YBXGgqQ'), true)
assert.equal(
  isWechatArticleUrl('https://mp.weixin.qq.com/s?__biz=MzIwNzc2NTk0NQ==&mid=1&idx=1&sn=x'),
  true,
)
assert.equal(isWechatArticleUrl('https://www.uisdc.com/seedance-2-5-5'), false)

// 文章页骨架与线上一致：og:title、activity-name 标题、js_content 带 visibility:hidden，
// 图片全部 data-src 懒加载（mmbiz CDN），文末夹 mp-style-type 排版标记
const wechatParagraphs = Array.from(
  { length: 20 },
  (_, i) =>
    `<p style="line-height: 1.75em;">第 ${i + 1} 段：直连 mp.weixin.qq.com 文章页抽出的正文内容，用于验证公众号解析器在镜像 feed 缺全文或合集条目没有正文时，仍然可以按站内全文路径完成阅读。</p>`,
).join('')
const wechatPageFixture = `<!DOCTYPE html><html><head>
<meta property="og:title" content="直连正文抽取样张" />
</head><body>
<div class="rich_media">
  <h1 class="rich_media_title" id="activity-name"><span class="js_title_inner">直连正文抽取样张</span></h1>
  <div class="rich_media_content js_underline_content defaultNoSetting" id="js_content" style="visibility: hidden; opacity: 0; ">
    <p><img class="rich_pages wxw-img" data-ratio="0.5" data-src="https://mmbiz.qpic.cn/sz_mmbiz_jpg/hero/640?wx_fmt=jpeg" data-w="1080" width="100%"></p>
    ${wechatParagraphs}
    <p style="display: none;"><mp-style-type data-value="3"></mp-style-type></p>
  </div>
</div>
<div id="js_pc_qr_code">打开微信扫一扫</div>
</body></html>`

const wechatBody = extractWechatBodyHtml(wechatPageFixture)
assert.ok(wechatBody, 'js_content body must be extracted')
assert.ok(wechatBody.includes('第 1 段'), 'body text preserved')
assert.ok(!wechatBody.includes('mp-style-type'), 'mp-style-type marker stripped')
assert.ok(!wechatBody.includes('打开微信扫一扫'), 'page chrome outside js_content excluded')
assert.ok(wechatBody.includes('data-src'), 'lazy images kept for normalizeContentImages to lift')
assert.equal(extractWechatArticleTitle(wechatPageFixture), '直连正文抽取样张')
assert.ok(isSubstantialHtml(wechatBody), 'direct-page body must pass the substantial check')

// 验证壳（数据中心 IP 抓 /s?__biz=… 的常见响应）：没有 js_content，且必须判为拦截页
const verifyShellFixture = `<!DOCTYPE html><html><head><title></title>
<link rel="stylesheet" href="//res.wx.qq.com/mmbizwap/zh_CN/htmledition/style/page/secitptpage/verify802853.css" media="all">
</head><body class="zh_CN"><div class="weui-msg"><div id="tips" class="top_tips warning"></div></div>
<script>var PAGE_MID='mmbizwap:secitptpage/verify.html';</script></body></html>`
assert.equal(extractWechatBodyHtml(verifyShellFixture), undefined, 'verify shell has no body')
assert.equal(
  isBlockedPublisherHtml(verifyShellFixture),
  true,
  'verify shell must be treated as blocked so the soft fallback engages',
)
// 正常文章页不得误判为拦截页
assert.equal(isBlockedPublisherHtml(wechatPageFixture), false)

console.log('✓ wechat article page extractor & verify-shell rejection verified')

console.log('\nAll community & wechat source tests passed!')
