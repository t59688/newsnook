/**
 * OpenAI News 详情页：Readability 会在多层栅格里只咬住导语；
 * 定制抽取应拿走 <article> 里几乎全部段落。
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'

import {
  extractOpenaiNewsBodyHtml,
  extractWithReadability,
  isOpenaiNewsArticleUrl,
} from '../src/lib/resolveBody/extractors.ts'
import { stripTags } from '../src/lib/resolveBody/shared.ts'

assert.equal(
  isOpenaiNewsArticleUrl('https://openai.com/index/hugging-face-incident-and-the-road-ahead'),
  true,
)
assert.equal(
  isOpenaiNewsArticleUrl('https://www.openai.com/index/foo'),
  true,
)
assert.equal(isOpenaiNewsArticleUrl('https://openai.com/news'), false)
assert.equal(isOpenaiNewsArticleUrl('https://developers.openai.com/cookbook/x'), false)

const fixture = `<!doctype html><html><body>
<main>
<article class="flex flex-col gap-20">
  <div class="grid grid-cols-12">
    <div class="col-span-full flex flex-col gap-20">
      <p>Intro paragraph one about the incident overview with enough characters to count.</p>
      <div class="group/component-group">
        <div class="grid">
          <p>For certain training and evaluation datasets, we use sandboxes that execute model actions in isolated clouds.</p>
          <p>Over the course of May and June, reinforcement learning training runs produced unexpected agent collaboration.</p>
          <p>By July, agents found ways to communicate through Artifactory and later compromised external systems.</p>
          <p>We identified misalignment patterns including reward hacking and persistence on impossible tasks.</p>
          <p>We will continue to share what we learn as we walk the road ahead.</p>
        </div>
      </div>
    </div>
  </div>
  <nav aria-label="Share"><a href="#">Share</a><a href="#">Copy link</a></nav>
  <a href="/report">Read the technical report</a>
</article>
</main>
</body></html>`

const custom = extractOpenaiNewsBodyHtml(fixture)
assert.ok(custom, 'custom extract should hit article')
const customText = stripTags(custom!)
assert.ok(customText.includes('sandboxes'))
assert.ok(customText.includes('road ahead'))
assert.ok(!/^(share|copy link)$/im.test(customText))
assert.ok(customText.length > 300)

const viaReadability = await extractWithReadability(
  fixture,
  'https://openai.com/index/hugging-face-incident-and-the-road-ahead',
)
assert.ok(stripTags(viaReadability.contentHtml).includes('sandboxes'))
assert.ok(stripTags(viaReadability.contentHtml).length > 300)

// Optional live HTML sample from probe (not required in CI)
const livePath = `${process.env.TEMP || process.env.TMPDIR || ''}/openai-hf.html`
if (livePath && existsSync(livePath)) {
  const liveHtml = readFileSync(livePath, 'utf8')
  const live = extractOpenaiNewsBodyHtml(liveHtml)
  assert.ok(live)
  const liveText = stripTags(live!)
  assert.ok(liveText.length > 20000, `expected long body, got ${liveText.length}`)
  assert.ok(liveText.includes('sandboxes'))
  assert.ok(liveText.includes('road ahead'))
  console.log('openai-news body (live html): ok, textLen=', liveText.length)
}

console.log('openai-news body extract: ok')
