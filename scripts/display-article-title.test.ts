import assert from 'node:assert/strict'

const { displayArticleTitle } = await import('../src/lib/displayArticleTitle')

assert.equal(
  displayArticleTitle('马斯克带火的脑机接口，其实还没那么热-36氪', { sourceName: '36 氪' }),
  '马斯克带火的脑机接口，其实还没那么热',
)
assert.equal(
  displayArticleTitle('标题示例 - 36 氪', { sourceName: '36 氪', sourceLabel: '36氪' }),
  '标题示例',
)
assert.equal(
  displayArticleTitle('纯标题无来源', { sourceName: '36氪' }),
  '纯标题无来源',
)

console.log('display article title tests passed')
