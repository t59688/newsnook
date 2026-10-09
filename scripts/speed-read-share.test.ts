import assert from 'node:assert/strict'

const { buildCardHtml } = await import('../src/lib/speedReadShare/buildCardHtml')
const { SPEED_READ_SECTION_TITLES: S } = await import('../src/features/speedRead/sections')
const { ZHIHU_ANSWER_SPEED_READ_SECTION_TITLES: A } = await import('../src/features/speedRead/sections')

const markdown = `## ${S.conclusion}
核心判断。
## ${S.satire}
把改革说成换桌布。
## ${S.structure}
补贴进门，风险出门。
## ${S.situation}
续签成了晚饭唯一的正经话题。
## ${S.keyPoints}
- 脉络一条
## ${S.warnings}
- 注意一条
`

const styles = ['warm-paper', 'editorial', 'dusk', 'journal'] as const

for (const style of styles) {
  const html = buildCardHtml(
    {
      articleTitle: '测试标题',
      sourceName: '测试源',
      model: 'test-model',
      markdown,
    },
    style,
  )
  const triad = html.indexOf('class="triad"')
  const satire = html.indexOf(`>${S.satire}<`)
  const structure = html.indexOf(`>${S.structure}<`)
  const situation = html.indexOf(`>${S.situation}<`)
  const keyPoints = html.indexOf(S.keyPoints)
  assert.notEqual(triad, -1, `${style}: 必须有 triad 带`)
  assert.ok(satire > triad, `${style}: 讽世在 triad 内`)
  assert.ok(structure > satire, `${style}: 析世在讽世后`)
  assert.ok(situation > structure, `${style}: 观世在析世后`)
  assert.ok(keyPoints > situation, `${style}: 重点脉络在三评后`)
  assert.match(html, /把改革说成换桌布/)
  assert.match(html, /补贴进门，风险出门/)
  assert.match(html, /续签成了晚饭唯一的正经话题/)
}

const editorial = buildCardHtml(
  {
    articleTitle: '测试标题',
    sourceName: '测试源',
    markdown,
  },
  'editorial',
)
assert.match(editorial, /<span class="no">02<\/span><h3>重点脉络<\/h3>/)
assert.match(editorial, /<span class="no">03<\/span><h3>值得注意<\/h3>/)
assert.doesNotMatch(editorial, /<span class="no">02<\/span><h3>讽世<\/h3>/)

const empty = buildCardHtml(
  {
    articleTitle: '测试标题',
    sourceName: '测试源',
    markdown: `## ${S.conclusion}\n结论\n## ${S.keyPoints}\n- a\n## ${S.warnings}\n- b\n`,
  },
  'warm-paper',
)
assert.match(empty, /class="triad"/)
assert.equal((empty.match(/>—</g) || []).length >= 3, true, '缺三评时每行占位为 —')
assert.doesNotMatch(empty, /暂无额外可评/)

const answerMarkdown = `## ${A.conclusion}
作者的直接答案。
## ${A.satire}
- 从前提走向结论
## ${A.structure}
- 一段个人经验
## ${A.situation}
- 仅适用于特定情境
## ${A.keyPoints}
- 没有覆盖反例
## ${A.warnings}
- 个人经验不等于普遍事实
`
const answerCard = buildCardHtml(
  {
    articleTitle: '测试问题',
    sourceName: '知乎 · 测试作者',
    markdown: answerMarkdown,
    profile: 'zhihu-answer',
  },
  'editorial',
)
assert.match(answerCard, new RegExp(A.conclusion))
assert.match(answerCard, new RegExp(A.satire))
assert.match(answerCard, new RegExp(A.structure))
assert.match(answerCard, new RegExp(A.situation))
assert.match(answerCard, new RegExp(A.keyPoints))
assert.match(answerCard, new RegExp(A.warnings))
assert.match(answerCard, /作者的直接答案/)

const explicit = buildCardHtml(
  {
    articleTitle: '测试标题',
    sourceName: '测试源',
    markdown: `## ${S.conclusion}\n结论\n## ${S.satire}\n暂无额外可评\n## ${S.structure}\n暂无额外可评\n## ${S.situation}\n暂无额外可评\n## ${S.keyPoints}\n- a\n## ${S.warnings}\n- b\n`,
  },
  'warm-paper',
)
assert.match(explicit, /暂无额外可评/)

console.log('speed read share tests passed')
