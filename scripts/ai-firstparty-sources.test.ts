/**
 * AI 一手官方源专项测试（2026-08-26 扩充）：
 * 1. 注册表 / 分类 / 代理分流 / 分页策略自检
 * 2. claude.com Webflow CMS 列表解析（/blog 与 /customers）
 * 3. academy.claude.com 卡片列表解析（无日期，hasRealDate=false）
 * 4. developers.openai.com/cookbook 列表行解析（标题 + 日期）
 * 5. 结构变化时的链接兜底路径
 *
 * 用法：npx tsx scripts/ai-firstparty-sources.test.ts
 */
import assert from 'node:assert/strict'

import { parseSourcePayload } from '../src/lib/parseFeed'
import {
  DEFAULT_INTERNATIONAL_DOMAINS,
  DEFAULT_INTERNATIONAL_SOURCE_IDS,
} from '../src/features/proxy/config'
import { CATEGORIES, uncoveredSourceIds } from '../src/sources/categories'
import { duplicateSourcesAcrossCategories } from '../src/sources/presets'
import { findSource, pagingStrategyOf } from '../src/sources/registry'

// —— 1. 注册与默认启用检查 ——
const NEW_SOURCE_IDS = [
  'claude-blog',
  'claude-customers',
  'claude-academy-use-cases',
  'claude-academy-tutorials',
  'openai-cookbook',
]

for (const id of NEW_SOURCE_IDS) {
  const src = findSource(id)
  assert.ok(src, `Source ${id} must be registered in SOURCES`)
  assert.equal(src.group, 'ai', `Source ${id} must be in the ai group`)
  assert.equal(src.enabled, true, `Source ${id} must be enabled by default`)
  assert.ok(src.url.startsWith('https://'), `Source ${id} must use https`)
  assert.ok(!src.url.endsWith('/'), `Source ${id} URL must not have a trailing slash (307/308)`)
  // 一次目录 + 客户端窗口分页
  assert.equal(pagingStrategyOf(src), 'client-catalog')
}

// 既有一手源保留且启用（任务硬约束：不得删减）
assert.equal(findSource('anthropic')?.enabled, true, 'anthropic must stay enabled')
assert.equal(findSource('openai-news')?.enabled, true, 'openai-news must be flipped to enabled')
assert.equal(findSource('openai-news')?.url, 'https://openai.com/news/rss.xml')

// 分类覆盖：全部落入「源头」，且分类间互斥仍成立
const aiCategory = CATEGORIES.find((cat) => cat.id === 'ai')
for (const id of NEW_SOURCE_IDS) {
  assert.ok(aiCategory?.sourceIds?.includes(id), `${id} must be covered by the ai category`)
}
assert.deepEqual(uncoveredSourceIds(), [])
const categoryDefaults: Record<string, string[]> = {}
for (const cat of CATEGORIES) {
  if (cat.sourceIds?.length) categoryDefaults[cat.id] = [...cat.sourceIds]
}
assert.deepEqual(duplicateSourcesAcrossCategories(categoryDefaults), [])

// 智能分流：claude.com 域名与全部新源 id 判为国际
assert.ok((DEFAULT_INTERNATIONAL_DOMAINS as readonly string[]).includes('claude.com'))
assert.ok((DEFAULT_INTERNATIONAL_DOMAINS as readonly string[]).includes('openai.com'))
for (const id of NEW_SOURCE_IDS) {
  assert.ok(DEFAULT_INTERNATIONAL_SOURCE_IDS.has(id), `${id} must route via proxy in auto mode`)
}

console.log('✓ registry / categories / proxy routing / paging verified')

// —— 2. claude.com Webflow CMS 列表 ——
const claudeBlogSource = findSource('claude-blog')!
const claudeBlogFixture = `
<!DOCTYPE html><html data-wf-domain="websitemain.claude.com"><body>
<div role="list" class="w-dyn-items">
<div role="listitem" class="blog_cms_item w-dyn-item">
  <div class="card_blog_visual"><img src="https://cdn.prod.website-files.com/abc/illo-1.svg" alt=""/></div>
  <div class="u-display-none">
    <div fs-list-field="heading">Claude&#x27;s memory works everywhere &amp; you decide what&#x27;s in it</div>
    <div fs-list-fieldtype="date" fs-list-field="date">August 25, 2026</div>
  </div>
  <a data-cta-copy="x" href="/blog/claudes-memory-works-everywhere" class="clickable_link"><span>read</span></a>
  <a aria-hidden="true" fs-list-element="item-link" href="/blog/claudes-memory-works-everywhere"></a>
</div>
<div role="listitem" class="blog_cms_item w-dyn-item">
  <div class="u-display-none">
    <div fs-list-field="heading">The AI-native SDLC playbook</div>
    <div fs-list-fieldtype="date" fs-list-field="date">August 18, 2026</div>
  </div>
  <a fs-list-element="item-link" href="/blog/the-ai-native-sdlc-playbook"></a>
</div>
</div>
<div class="marquee_wrap"><div role="list" class="marquee_cms_blog_list w-dyn-items">
<div role="listitem" class="marquee_cms_blog_list_item w-dyn-item">
  <div class="marquee_cms_blog_list_item_content">
    <h2 class="u-text-style-h6 u-mb-1">Claude Code now supports artifacts</h2>
    <div class="u-text-style-caption u-foreground-tertiary">June 18, 2026</div>
  </div>
  <a data-cta-copy="Claude Code now supports artifacts" href="/blog/artifacts-in-claude-code" class="clickable_link"><span>Read more</span></a>
</div>
<div role="listitem" class="marquee_cms_blog_list_item w-dyn-item">
  <div class="marquee_cms_blog_list_item_content">
    <h2 class="u-text-style-h6">The AI-native SDLC playbook</h2>
  </div>
  <a href="/blog/the-ai-native-sdlc-playbook" class="clickable_link"><span>Read more</span></a>
</div>
</div></div>
</body></html>`

const blogArticles = parseSourcePayload(claudeBlogSource, claudeBlogFixture)
assert.equal(blogArticles.length, 3)
assert.equal(blogArticles[0].title, "Claude's memory works everywhere & you decide what's in it")
assert.equal(blogArticles[0].originUrl, 'https://claude.com/blog/claudes-memory-works-everywhere')
assert.equal(blogArticles[0].hasRealDate, true)
assert.equal(
  new Date(blogArticles[0].publishedAt).toISOString().slice(0, 10),
  '2026-08-25',
)
assert.equal(blogArticles[0].image, 'https://cdn.prod.website-files.com/abc/illo-1.svg')
assert.equal(blogArticles[1].title, 'The AI-native SDLC playbook')
// 跑马灯重复渲染同一篇（无日期）时，不得覆盖网格里的带日期版本
assert.equal(blogArticles[1].hasRealDate, true)
// 跑马灯条目（h2 标题 + 英文日期文本，无 fs-list-field 元数据）也要收进目录
const marqueeArticle = blogArticles.find(
  (article) => article.originUrl === 'https://claude.com/blog/artifacts-in-claude-code',
)
assert.ok(marqueeArticle, 'marquee-only item must be captured')
assert.equal(marqueeArticle!.title, 'Claude Code now supports artifacts')
assert.equal(marqueeArticle!.hasRealDate, true)
assert.equal(new Date(marqueeArticle!.publishedAt).toISOString().slice(0, 10), '2026-06-18')

const claudeCustomersSource = findSource('claude-customers')!
const claudeCustomersFixture = `
<html><body>
<div role="listitem" class="stories_cms_item w-dyn-item"><article>
  <a data-cta="Customer stories page" href="/customers/notion-qa" class="clickable_link"><span>View story</span></a>
  <h3 fs-list-field="client" class="card_cs_list_title">Notion Q&amp;A</h3>
  <div class="u-display-none"><div fs-list-field="title">How Notion ships and scales agents with Claude Managed Agents</div></div>
  <div role="listitem" class="w-dyn-item"><div fs-list-field="product">Claude Platform</div></div>
  <div fs-list-fieldtype="date" fs-list-field="date" class="u-display-none">August 21, 2026</div>
</article></div>
<div role="listitem" class="stories_cms_item w-dyn-item"><article>
  <a href="/customers/caylent" class="clickable_link"><span>View story</span></a>
  <h3 fs-list-field="client" class="card_cs_list_title">Caylent</h3>
  <div fs-list-fieldtype="date" fs-list-field="date" class="u-display-none">August 3, 2026</div>
</article></div>
</body></html>`

const customerArticles = parseSourcePayload(claudeCustomersSource, claudeCustomersFixture)
assert.equal(customerArticles.length, 2)
// 有故事标题用故事标题
assert.equal(
  customerArticles[0].title,
  'How Notion ships and scales agents with Claude Managed Agents',
)
assert.equal(customerArticles[0].originUrl, 'https://claude.com/customers/notion-qa')
assert.equal(customerArticles[0].hasRealDate, true)
// 缺故事标题时退回客户名
assert.equal(customerArticles[1].title, 'Caylent')

// 集合结构变化：退回可见链接 + slug 可读化标题
const blogFallbackArticles = parseSourcePayload(
  claudeBlogSource,
  '<html><body><a href="/blog/ai-ci-cd-on-call">x</a><a href="/blog/ai-ci-cd-on-call">x</a></body></html>',
)
assert.equal(blogFallbackArticles.length, 1)
assert.equal(blogFallbackArticles[0].title, 'Ai Ci Cd On Call')
assert.equal(blogFallbackArticles[0].hasRealDate, false)

console.log('✓ claude.com Webflow CMS list parser verified (blog + customers + fallback)')

// —— 3. academy.claude.com 卡片列表 ——
const academySource = findSource('claude-academy-use-cases')!
const academyFixture = `
<html><body>
<a href="/use-cases/incident-postmortem" class="group relative isolate flex">
  <div><h3 class="font-heading text-pretty">Draft the incident postmortem</h3>
  <span class="flex items-center gap-1.5">10 min</span></div>
</a>
<a href="/use-cases/incident-postmortem" class="group">
  <h3 class="font-heading">Draft the incident postmortem</h3>
</a>
<a href="/use-cases/turn-research-into-presentations" class="group relative">
  <h3 class="font-heading text-pretty">Turn research into presentations</h3>
</a>
<a href="/collections/ai-fluency">not a use case</a>
</body></html>`

const academyArticles = parseSourcePayload(academySource, academyFixture)
assert.equal(academyArticles.length, 2, 'should dedupe repeated card and skip non-matching paths')
assert.equal(academyArticles[0].title, 'Draft the incident postmortem')
assert.equal(
  academyArticles[0].originUrl,
  'https://academy.claude.com/use-cases/incident-postmortem',
)
assert.equal(academyArticles[1].title, 'Turn research into presentations')
// 列表无真实日期：源内保持顺序，但不得把抓取时刻标成发稿时间
assert.equal(academyArticles[0].hasRealDate, false)
assert.ok(academyArticles[0].publishedAt > academyArticles[1].publishedAt)

const tutorialsSource = findSource('claude-academy-tutorials')!
const tutorialsArticles = parseSourcePayload(
  tutorialsSource,
  '<a href="/tutorials/creating-your-first-skill" class="group"><h3 class="font-heading">Creating your first skill</h3></a>',
)
assert.equal(tutorialsArticles.length, 1)
assert.equal(
  tutorialsArticles[0].originUrl,
  'https://academy.claude.com/tutorials/creating-your-first-skill',
)

console.log('✓ academy.claude.com card list parser verified (use-cases + tutorials)')

// —— 4. OpenAI Cookbook 列表行 ——
const cookbookSource = findSource('openai-cookbook')!
const cookbookFixture = `
<html><body>
<a class="resource-item not-prose" href="/cookbook/examples/chatgpt/workspace_agents/workspace-agents-api-trigger">
  <img src="https://cdn.openai.com/devhub/resources/cookbook-1.png" alt="Featured card without list row markup">
</a>
<a class="featured-card" href="/cookbook/examples/multimodal/transparent-image-assets">
  <div class="text-sm line-clamp-1">Generate Transparent Image Assets for Campaigns &amp; Presentations</div>
</a>
<div class="divide-y divide-gray-200">
<a data-hk="s1" href="/cookbook/examples/multimodal/transparent-image-assets" class="flex flex-col sm:flex-row">
  <div class="flex-1 pr-4 my-2 sm:my-0 text-default text-sm line-clamp-1">Generate Transparent Image Assets for Campaigns &amp; Presentations</div>
  <span class="text-xs font-medium whitespace-nowrap ui-font">Codex</span>
  <span class="text-xs text-gray-500 dark:text-gray-400 sm:w-24 text-right">Aug 20, 2026</span>
</a>
<a data-hk="s2" href="/cookbook/articles/per_run_spending_controller_responses_api" class="flex flex-col">
  <div class="flex-1 pr-4 text-sm line-clamp-1">Build a per-run spending controller with the Responses API</div>
  <span class="text-xs text-gray-500 sm:w-24 text-right">Aug 17, 2026</span>
</a>
</div>
</body></html>`

const cookbookArticles = parseSourcePayload(cookbookSource, cookbookFixture)
assert.equal(cookbookArticles.length, 2, 'featured card without list-row markup must be skipped')
assert.equal(
  cookbookArticles[0].title,
  'Generate Transparent Image Assets for Campaigns & Presentations',
)
assert.equal(
  cookbookArticles[0].originUrl,
  'https://developers.openai.com/cookbook/examples/multimodal/transparent-image-assets',
)
// 同一篇同时出现在无日期 Featured 区与带日期 Latest 列表时，日期不得被 Featured 版本抢占
assert.equal(cookbookArticles[0].hasRealDate, true)
assert.equal(
  new Date(cookbookArticles[0].publishedAt).toISOString().slice(0, 10),
  '2026-08-20',
)
assert.equal(
  cookbookArticles[1].originUrl,
  'https://developers.openai.com/cookbook/articles/per_run_spending_controller_responses_api',
)

// 列表结构变化：退回文章链接兜底
const cookbookFallback = parseSourcePayload(
  cookbookSource,
  '<a href="/cookbook/examples/codex/code_modernization/">x</a>',
)
assert.equal(cookbookFallback.length, 1)
assert.equal(cookbookFallback[0].title, 'Code Modernization')
assert.equal(
  cookbookFallback[0].originUrl,
  'https://developers.openai.com/cookbook/examples/codex/code_modernization',
)

console.log('✓ OpenAI Cookbook list parser verified (rows + fallback)')

console.log('\nAll AI first-party source tests passed!')
