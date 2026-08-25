/**
 * 高质量深度信源专项测试：
 * 1. 注册表与分类全覆盖 / 互斥自检
 * 2. Paul Graham 静态列表解析器
 * 3. Substack / Ghost content:encoded 富文本保留与正文判断
 * 4. 摘要清理引擎 Substack 订阅前缀过滤
 * 
 * 用法：npx tsx scripts/high-signal-sources.test.ts
 */
import assert from 'node:assert/strict'

import { parseSourcePayload } from '../src/lib/parseFeed'
import { isSubstantialHtml } from '../src/lib/resolveBody'
import { cleanSummaryText } from '../src/lib/cleanSummary'
import { CATEGORIES, uncoveredSourceIds } from '../src/sources/categories'
import { duplicateSourcesAcrossCategories } from '../src/sources/presets'
import { findSource } from '../src/sources/registry'

// —— 1. 17 个高质量信源注册与属性完整性检查 ——
const HIGH_SIGNAL_SOURCE_IDS = [
  'foreign-affairs',
  'nyrb',
  'bloomberg-opinion',
  'project-syndicate',
  'sinocism',
  'theinitium',
  'quanta',
  'stratechery',
  'vitalik',
  'fabricated-knowledge',
  'construction-physics',
  'paulgraham',
  'v2ex',
  'astral-codex-ten',
  'marginalian',
  'aldaily',
  'theue',
]

for (const id of HIGH_SIGNAL_SOURCE_IDS) {
  const src = findSource(id)
  assert.ok(src, `Source ${id} must be registered in SOURCES`)
  assert.ok(src.name, `Source ${id} must have a name`)
  assert.ok(src.label, `Source ${id} must have a label`)
  assert.ok(src.url && src.url.startsWith('http'), `Source ${id} must have a valid http(s) URL`)
  assert.ok(src.group, `Source ${id} must have a group`)
  assert.ok(src.kind, `Source ${id} must have a kind`)
}

console.log('✓ All 17 high-signal sources successfully registered in registry.ts')

// —— 2. 分类全覆盖与互斥性检查 ——
const uncovered = uncoveredSourceIds()
assert.deepEqual(uncovered, [], `All registered sources must be covered by CATEGORIES, uncovered: ${uncovered.join(', ')}`)

const categoryDefaults: Record<string, string[]> = {}
for (const cat of CATEGORIES) {
  if (cat.sourceIds?.length) categoryDefaults[cat.id] = [...cat.sourceIds]
}
const dupes = duplicateSourcesAcrossCategories(categoryDefaults)
assert.deepEqual(dupes, [], `CATEGORIES must be mutually exclusive, dupes: ${dupes.join(', ')}`)

console.log('✓ Categories coverage & mutual exclusivity 100% verified')

// —— 3. Paul Graham Essays 网页列表解析测试 ——
const pgSource = findSource('paulgraham')!
const pgHtmlFixture = `
<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">
<html>
<head><title>Articles</title></head>
<body>
<table border="0" cellspacing="0" cellpadding="0">
<tr><td>
<table border="0" cellspacing="0" cellpadding="0">
<font size="2" face="verdana">
<a href="superlinear.html">Superlinear Returns</a><br>
<a href="howtodo.html">How to Do Great Work</a><br>
<a href="articles.html">Articles</a><br>
<a href="index.html">Index</a><br>
<a href="https://www.paulgraham.com/read.html">Need to Read</a><br>
</font>
</table>
</td></tr>
</table>
</body>
</html>
`

const pgArticles = parseSourcePayload(pgSource, pgHtmlFixture)
assert.equal(pgArticles.length, 3, 'Should extract 3 valid articles, skipping articles.html & index.html')
assert.equal(pgArticles[0].title, 'Superlinear Returns')
assert.equal(pgArticles[0].originUrl, 'https://www.paulgraham.com/superlinear.html')
assert.equal(pgArticles[1].title, 'How to Do Great Work')
assert.equal(pgArticles[1].originUrl, 'https://www.paulgraham.com/howtodo.html')
assert.equal(pgArticles[2].title, 'Need to Read')
assert.equal(pgArticles[2].originUrl, 'https://www.paulgraham.com/read.html')
// 列表无真实日期：源内仍倒序，但不得把抓取时刻标成发稿时间
assert.equal(pgArticles[0].hasRealDate, false)
assert.ok(pgArticles[0].publishedAt > pgArticles[1].publishedAt)
assert.ok(pgArticles[1].publishedAt > pgArticles[2].publishedAt)

console.log('✓ Paul Graham HTML catalog parser verified')

// —— 4. Substack / Ghost content:encoded 富文本解析与全文判断 ——
const vitalikSource = findSource('vitalik')!
const substackRssFixture = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Vitalik Buterin's website</title>
    <link>https://vitalik.eth.limo/</link>
    <item>
      <title>Possible futures of the Ethereum protocol, part 1: The Merge</title>
      <link>https://vitalik.eth.limo/general/2024/10/14/futures1.html</link>
      <pubDate>Mon, 14 Oct 2024 00:00:00 +0000</pubDate>
      <description>Summary of the Merge and proof of stake.</description>
      <content:encoded><![CDATA[
        <p>Special thanks to Justin Drake, Hsiao-wei Wang and others for feedback and review.</p>
        <p>The Ethereum network has successfully transitioned to proof of stake over two years ago. In this post, we will explore the future roadmap and long-term milestones for improving the consensus layer, reducing slot times, and enhancing single-slot finality across the entire decentralized network of validators.</p>
        <p>Proof of stake has dramatically decreased energy consumption by over 99.9% while increasing economic security through slashing mechanisms.</p>
        <p>Further improvements to the consensus mechanism include single slot finality (SSF), which allows blocks to be finalized in a single 12-second slot rather than requiring two epochs (64 slots / 12.8 minutes).</p>
        <p>This is achieved through advanced cryptographic primitives such as aggregate BLS signatures and validator rotation committees that distribute the computation load evenly across participants.</p>
      ]]></content:encoded>
    </item>
  </channel>
</rss>`

const vitalikArticles = parseSourcePayload(vitalikSource, substackRssFixture)
assert.equal(vitalikArticles.length, 1)
assert.equal(vitalikArticles[0].title, 'Possible futures of the Ethereum protocol, part 1: The Merge')
assert.ok(vitalikArticles[0].contentHtml, 'contentHtml should be populated from content:encoded')
assert.ok(isSubstantialHtml(vitalikArticles[0].contentHtml), 'Substantial Substack body should be recognized as full text')

console.log('✓ Substack / Ghost content:encoded extraction & fulltext check verified')

// —— 5. 摘要清理：Substack 订阅导语过滤 ——
const rawSummary = 'Thanks for reading Fabricated Knowledge! Subscribe now to receive new posts. Semiconductor manufacturing equipment is experiencing a multi-year supercycle.'
const cleaned = cleanSummaryText(rawSummary)
assert.ok(!cleaned.includes('Thanks for reading'))
assert.ok(!cleaned.includes('Subscribe now'))
assert.ok(cleaned.includes('Semiconductor manufacturing equipment'))

console.log('✓ Substack boilerplate summary cleaner verified')

// —— 6. AI 深度解读 / 评测信源注册检查 ——
const AI_DEPTH_SOURCE_IDS = [
  'zhidx',
  'baoyu',
  'oneusefulthing',
  'understandingai',
  'latent-space',
  'thezvi',
]

// AI 拆分为「一手（ai）/ 深度（ai-depth）」两栏后，深度解读源统一归 ai-depth
const aiDepthCategory = CATEGORIES.find((cat) => cat.id === 'ai-depth')
assert.ok(aiDepthCategory?.sourceIds, 'ai-depth category must declare sourceIds')
for (const id of AI_DEPTH_SOURCE_IDS) {
  const src = findSource(id)
  assert.ok(src, `AI depth source ${id} must be registered in SOURCES`)
  assert.equal(src.group, 'ai', `AI depth source ${id} must be in the ai group`)
  assert.ok(src.url.startsWith('https://'), `AI depth source ${id} must use https`)
  assert.ok(
    aiDepthCategory!.sourceIds!.includes(id),
    `AI depth source ${id} must be covered by the ai-depth category`,
  )
}

// 分类里引用的 id 必须都已注册，防止手写 sourceIds 拼错
for (const cat of CATEGORIES) {
  for (const id of cat.sourceIds ?? []) {
    assert.ok(findSource(id), `Category ${cat.id} references unregistered source ${id}`)
  }
}

console.log('✓ AI depth/review sources registered & category references verified')

// —— 7. V2EX 分享创造（非普通发帖/水帖）验证 ——
const v2exSource = findSource('v2ex')!
assert.equal(v2exSource.url, 'https://www.v2ex.com/feed/create.xml')
assert.equal(v2exSource.name, 'V2EX 分享创造')

const v2exFixture = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>分享创造</title>
  <updated>2026-08-06T09:48:29Z</updated>
  <entry>
    <title>开源我的终端套壳项目，无限横向拓展的 libghostty 窗口</title>
    <link rel="alternate" type="text/html" href="https://www.v2ex.com/t/1232515#reply2" />
    <id>tag:www.v2ex.com,2026-08-06:/t/1232515</id>
    <published>2026-08-06T09:48:29Z</published>
    <content type="html"><![CDATA[<p>这是我利用业余时间开发的项目，支持多种终端布局与多标签管理。</p>]]></content>
  </entry>
</feed>`
const v2exArticles = parseSourcePayload(v2exSource, v2exFixture)
assert.equal(v2exArticles.length, 1)
assert.equal(v2exArticles[0].title, '开源我的终端套壳项目，无限横向拓展的 libghostty 窗口')
assert.ok(v2exArticles[0].summary.includes('业余时间开发'))

console.log('✓ V2EX curated "create" (分享创造) feed verified')

console.log('\nAll high-signal sources intake tests passed!')
