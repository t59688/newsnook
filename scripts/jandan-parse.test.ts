/**
 * 验证煎蛋 HTML 列表 / 分页 / RSS 兜底 → Article 解析（新鲜事）。
 * 用法：npx tsx scripts/jandan-parse.test.ts
 */
import {
  findSource,
  maxOffsetPages,
  offsetPageRequest,
  pagingStrategyOf,
  SOURCES,
  type NewsSource,
} from '../src/sources/registry'
import { uncoveredSourceIds } from '../src/sources/categories'
import { parseSourcePayload } from '../src/lib/parseFeed'
import { extractWithReadability } from '../src/lib/resolveBody/extractors'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  })
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
  return response.text()
}

function assertSource(id: string): NewsSource {
  const source = findSource(id)
  if (!source) throw new Error(`missing source ${id}`)
  if (source.kind !== 'jandan') throw new Error(`${id} kind is ${source.kind}`)
  return source
}

const uncovered = uncoveredSourceIds()
if (uncovered.length) {
  throw new Error(`categories missing sources: ${uncovered.join(', ')}`)
}

const jandanIds = SOURCES.filter((s) => s.kind === 'jandan').map((s) => s.id)
if (jandanIds.length !== 1 || jandanIds[0] !== 'jandan') {
  throw new Error(`expected only jandan, got ${jandanIds.join(', ')}`)
}

const source = assertSource('jandan')

// 1. 验证分页策略与上游翻页 URL
if (pagingStrategyOf(source) !== 'upstream-offset') {
  throw new Error(`expected upstream-offset paging, got ${pagingStrategyOf(source)}`)
}
if (maxOffsetPages(source) < 5) {
  throw new Error(`expected maxOffsetPages >= 5, got ${maxOffsetPages(source)}`)
}
const p0 = offsetPageRequest(source, 0)
if (p0.url !== 'https://jandan.net/') {
  throw new Error(`expected page 0 url https://jandan.net/, got ${p0.url}`)
}
const p1 = offsetPageRequest(source, 1)
if (p1.url !== 'https://jandan.net/page/2') {
  throw new Error(`expected page 1 url https://jandan.net/page/2, got ${p1.url}`)
}

// 2. 验证官网 HTML 列表解析
const payload = await fetchText(source.url)
const articles = parseSourcePayload(source, payload)

if (articles.length < 10) {
  throw new Error(`jandan: expected >=10 articles from homepage, got ${articles.length}`)
}

const sample = articles[0]
if (!sample.originUrl.startsWith('https://jandan.net/p/')) {
  throw new Error(`jandan: bad originUrl ${sample.originUrl}`)
}
if (!sample.title.trim()) throw new Error('jandan: empty title')
if (!sample.hasRealDate) throw new Error('jandan: missing published date')
if (!sample.summary) throw new Error('jandan: expected summary in list item')

console.log(`jandan: list ok (${articles.length} items)`)
for (const article of articles.slice(0, 3)) {
  console.log(
    `  - ${new Date(article.publishedAt).toISOString().slice(0, 10)} ${article.title}`,
  )
}

// 3. 验证详情页正文 Readability 解析
const detailHtml = await fetchText(sample.originUrl)
const extracted = await extractWithReadability(detailHtml, sample.originUrl)
if (!extracted || !extracted.contentHtml || extracted.contentHtml.length < 100) {
  throw new Error(`jandan: detail extraction failed, length=${extracted?.contentHtml?.length}`)
}
console.log(`jandan: detail extraction ok (${extracted.contentHtml.length} chars, source=${extracted.bodySource})`)

// 4. 验证向下兼容：RSS XML 解析
const dummyRss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>煎蛋</title>
    <item>
      <title>测试新鲜事</title>
      <link>https://jandan.net/p/999999</link>
      <description>测试摘要</description>
    </item>
  </channel>
</rss>`
const rssArticles = parseSourcePayload(source, dummyRss)
if (rssArticles.length !== 1 || rssArticles[0].title !== '测试新鲜事') {
  throw new Error('jandan: RSS fallback parse failed')
}
console.log('jandan: RSS fallback parse ok')

console.log('jandan-parse: all ok')
