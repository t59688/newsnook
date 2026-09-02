import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'

const { window } = parseHTML('<!doctype html><html><body></body></html>')
Object.assign(globalThis, {
  window,
  document: window.document,
  Node: window.Node,
  HTMLElement: window.HTMLElement,
})

const { buildArticleMarkdown, htmlToMarkdown, markdownFileName } = await import('../src/lib/articleMarkdown')

assert.equal(
  htmlToMarkdown(
    '<h2>标题</h2><p>正文 <strong>加粗</strong> <a href="/a">链接</a></p><ul><li>一</li><li>二</li></ul>',
    'https://example.com/post',
  ),
  '### 标题\n\n正文 **加粗** [链接](https://example.com/a)\n\n- 一\n- 二',
)
assert.equal(
  htmlToMarkdown('<a href="javascript:alert(1)">危险</a><script>alert(1)</script>', 'https://example.com/post'),
  '危险',
)
assert.equal(markdownFileName('A/B: C?'), 'A-B- C-.md')

const markdown = buildArticleMarkdown({
  article: {
    id: '1',
    title: '原题',
    summary: '',
    publishedAt: Date.UTC(2026, 8, 1),
    hasRealDate: true,
    sourceId: 'demo',
    sourceName: 'Demo',
    sourceLabel: 'Demo',
    sourceGroup: 'tech' as never,
    originUrl: 'https://example.com/post',
  },
  title: '真实标题',
  html: '<p>Hello</p><img src="/cover.jpg" alt="封面">',
  speedReadMarkdown: '## 有所闻\n结论',
  exportedAt: Date.UTC(2026, 8, 2),
})
assert.match(markdown, /title: "真实标题"/)
assert.match(markdown, /## AI 速读\n### 有所闻/)
assert.match(markdown, /## 正文\n\nHello\n\n!\[封面\]\(https:\/\/example\.com\/cover\.jpg\)/)
assert.match(markdown, /https:\/\/example\.com\/post/)
console.log('article markdown tests passed')
