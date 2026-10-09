import assert from 'node:assert/strict'

import { CATEGORIES, uncoveredSourceIds } from '../src/sources/categories'
import {
  parseSourcePayload,
  parseThePaperCursor,
  thePaperCursor,
  thePaperCursorAdvances,
  thePaperPageRequest,
} from '../src/lib/parseFeed'
import { DEFAULT_PREFERENCES } from '../src/sources/preferences'
import { BUILTIN_DEPTH_ID, findBuiltinPreset } from '../src/sources/presets'
import { findSource, offsetPageRequest, pagingStrategyOf, userAgentFor } from '../src/sources/registry'

const THEPAPER_IDS = [
  'thepaper-bookreview',
  'thepaper-people',
  'thepaper-research',
  'thepaper-ideas',
  'thepaper-science',
] as const

const INFZM_IDS = [
  'infzm-depth',
  'infzm-feature',
  'infzm-interview',
  'infzm-thinktank',
] as const

const ALL_IDS = [...THEPAPER_IDS, ...INFZM_IDS]

console.log('--- 中文深读信源注册 ---')

for (const id of THEPAPER_IDS) {
  const source = findSource(id)
  assert.ok(source, `${id} must be registered`)
  assert.equal(source.kind, 'thepaper')
  assert.equal(source.group, 'cn')
  assert.equal(source.enabled, false)
  assert.equal(source.requestMethod, 'POST')
  assert.equal(source.requestBodyType, 'json')
  assert.equal(typeof source.requestJson?.nodeId, 'number')
}
for (const id of INFZM_IDS) {
  const source = findSource(id)
  assert.ok(source, `${id} must be registered`)
  assert.equal(source.kind, 'infzm')
  assert.equal(source.group, 'cn')
  assert.equal(source.enabled, false)
  assert.match(source.url, /infzm\.com\/contents\?term_id=/)
  assert.match(userAgentFor(source), /Windows NT 10\.0/)
  assert.doesNotMatch(userAgentFor(source), /Mobile|Android/i)
}

// 已确认停更的思想湃不应进入当前产品信源。
assert.equal(findSource('thepaper-thought'), undefined)

const expectedPlacement: Record<string, string> = {
  'thepaper-bookreview': 'depth-books',
  'thepaper-people': 'cn-dialogue',
  'thepaper-research': 'cn-public',
  'thepaper-ideas': 'cn-opinion',
  'thepaper-science': 'science-research',
  'infzm-depth': 'depth-reporting',
  'infzm-feature': 'depth-reporting',
  'infzm-interview': 'cn-dialogue',
  'infzm-thinktank': 'cn-opinion',
}
for (const id of ALL_IDS) {
  const category = CATEGORIES.find((item) => item.id === expectedPlacement[id])
  assert.ok(category, `${id} semantic category must exist`)
  assert.ok(category.sourceIds?.includes(id), `${id} must be assigned to ${expectedPlacement[id]}`)
}
assert.deepEqual(uncoveredSourceIds(), [])

const depth = findBuiltinPreset(BUILTIN_DEPTH_ID)
assert.ok(depth)
assert.ok(depth.snapshot.categoryOrder.includes('depth-reporting'))
assert.ok(depth.snapshot.categoryOrder.includes('depth-books'))
assert.deepEqual(depth.snapshot.categorySources['depth-reporting'], ['infzm-depth', 'infzm-feature'])
assert.ok(depth.snapshot.categorySources['depth-books']?.includes('thepaper-bookreview'))
assert.ok(DEFAULT_PREFERENCES.hiddenCategoryIds.includes('depth-reporting'))
assert.ok(!DEFAULT_PREFERENCES.categoryOrder.includes('depth-reporting'))
assert.ok(ALL_IDS.every((id) => !DEFAULT_PREFERENCES.categorySources.mix?.includes(id)))

console.log('✓ registry/taxonomy/preset/default isolation ok')

console.log('--- 澎湃 JSON 解析与游标 ---')

const paper = findSource('thepaper-bookreview')!
const paperFixture = JSON.stringify({
  code: 200,
  data: {
    hasNext: true,
    startTime: 1788837532062,
    excludeContIds: ['34000000'],
    list: [
      {
        contId: '34080585',
        name: '顾真评《作家们毫无进展》｜他的天才，在于能够理解',
        pic: 'https://imgpai.thepaper.cn/example.png',
        publishTime: '2026-09-19 09:25:58',
        isOutForward: '0',
      },
      {
        contId: '34070000',
        name: '第二篇深度文章',
        smallPic: 'https://image.thepaper.cn/example.jpg',
        pubTimeLong: 1789700000000,
        isOutForward: '0',
      },
    ],
  },
})

const paperArticles = parseSourcePayload(paper, paperFixture)
assert.equal(paperArticles.length, 2)
assert.equal(
  paperArticles[0].originUrl,
  'https://www.thepaper.cn/newsDetail_forward_34080585',
)
assert.equal(paperArticles[0].hasRealDate, true)
assert.equal(paperArticles[0].image, 'https://imgpai.thepaper.cn/example.png')
assert.equal(paperArticles[0].neteaseDocId, undefined, '澎湃不得借用网易专属正文 id 字段')

const cursor = thePaperCursor(paperFixture)
assert.ok(cursor)
assert.deepEqual(parseThePaperCursor(cursor), {
  startTime: 1788837532062,
  excludeContIds: ['34000000'],
  hasNext: true,
})
assert.deepEqual(thePaperPageRequest(paper, cursor!, 1), {
  ...(paper.requestJson ?? {}),
  pageNum: 2,
  startTime: 1788837532062,
  excludeContIds: ['34000000'],
})
assert.equal(pagingStrategyOf(paper), 'upstream-cursor')
assert.equal(
  thePaperCursorAdvances(
    JSON.stringify({ startTime: 200, hasNext: true }),
    JSON.stringify({ startTime: 100, hasNext: true }),
  ),
  true,
)
assert.equal(
  thePaperCursorAdvances(
    JSON.stringify({ startTime: 100, hasNext: true }),
    JSON.stringify({ startTime: 100, hasNext: true }),
  ),
  false,
)

const exhaustedCursor = thePaperCursor(
  JSON.stringify({
    code: 200,
    data: { hasNext: false, startTime: 1788837532062, list: [] },
  }),
)
assert.ok(exhaustedCursor)
assert.equal(thePaperPageRequest(paper, exhaustedCursor!, 2), undefined)

console.log('✓ thepaper parser/cursor ok')

console.log('--- 南方周末 HTML 解析与页码 ---')

const infzm = findSource('infzm-depth')!
const infzmFixture = `
<ul class="nfzm-list">
  <li>
    <a href="/contents/331142?source=133&amp;source_1=202">
      <div class="nfzm-content-item">
        <img src="http://images.infzm.com/cms/medias/image/example.jpg">
        <header class="nfzm-content-item__title"><h5>7.7级误报背后：地震预警“两网”之争</h5></header>
        <div class="nfzm-content-item__description"><div>这是文章摘要，用于列表预览。</div></div>
        <footer class="nfzm-content-item__meta">
          <span>社会</span><span>7小时前</span><span>5评论</span>
        </footer>
      </div>
    </a>
  </li>
  <li>
    <a href="/contents/330813?source=133&amp;source_1=202">
      <div class="nfzm-content-item">
        <header class="nfzm-content-item__title"><h5>城中村里，一场野生的儿童艺术节</h5></header>
        <footer class="nfzm-content-item__meta">
          <span>文化头条</span><span>09-16</span><span>18评论</span>
        </footer>
      </div>
    </a>
  </li>
</ul>
`

const infzmArticles = parseSourcePayload(infzm, infzmFixture)
assert.equal(infzmArticles.length, 2)
assert.equal(infzmArticles[0].originUrl, 'https://www.infzm.com/contents/331142')
assert.equal(infzmArticles[0].hasRealDate, true)
assert.equal(infzmArticles[1].hasRealDate, true)
assert.equal(
  infzmArticles[0].image,
  'https://images.infzm.com/cms/medias/image/example.jpg',
)

const infzmPage2 = offsetPageRequest(infzm, 1)
assert.equal(new URL(infzmPage2.url).searchParams.get('term_id'), '202')
assert.equal(new URL(infzmPage2.url).searchParams.get('page'), '2')
assert.equal(pagingStrategyOf(infzm), 'upstream-offset')

console.log('✓ infzm parser/pagination ok')
console.log('All Chinese deep-source tests passed!')
