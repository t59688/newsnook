import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { normalizeParagraphTypography, sanitizeArticleHtml } from '../src/lib/sanitize'

// 1. 中文自带全角空格（\u3000\u3000）的段落，应剥离前导全角空格，并标记 data-cjk="true"
const chineseWithHardcodedIndent = `
<p>　　北京时间8月3日，据报道最新进展。</p>
<p>　　第二段也是自带全角缩进的内容。</p>
`
const cleanedChinese = normalizeParagraphTypography(chineseWithHardcodedIndent)
assert.match(cleanedChinese, /<p data-cjk="true">北京时间8月3日，据报道最新进展。<\/p>/)
assert.match(cleanedChinese, /<p data-cjk="true">第二段也是自带全角缩进的内容。<\/p>/)
assert.doesNotMatch(cleanedChinese, /\u3000/)

// 2. 带 &nbsp;&nbsp;&nbsp;&nbsp; 或连续空白的中文段落
const chineseWithNbsp = `
<p>&nbsp;&nbsp;&nbsp;&nbsp;这是使用非断空格排版的段落。</p>
<p>   这是使用普通空格排版的段落。</p>
`
const cleanedNbsp = sanitizeArticleHtml(chineseWithNbsp)
assert.match(cleanedNbsp, /<p data-cjk="true">这是使用非断空格排版的段落。<\/p>/)
assert.match(cleanedNbsp, /<p data-cjk="true">这是使用普通空格排版的段落。<\/p>/)

// 3. 嵌套 inline 标签（如 <span>　　</span>）里的前导缩进
const chineseWithSpanIndent = `
<p><span>　　</span>嵌套在 span 内的缩进文字。</p>
<p><strong>　　加粗前缀：</strong>正文内容开始。</p>
`
const cleanedSpan = normalizeParagraphTypography(chineseWithSpanIndent)
assert.match(cleanedSpan, /<p data-cjk="true">嵌套在 span 内的缩进文字。<\/p>/)
assert.match(cleanedSpan, /<p data-cjk="true"><strong>加粗前缀：<\/strong>正文内容开始。<\/p>/)

// 4. 纯英文/西文段落，不含 CJK 汉字，应标记 data-cjk="false"，且保留句中空格
const englishArticle = `
<p>Apple has officially announced its next generation chips.</p>
<p>The company said performance has increased by 40%.</p>
`
const cleanedEnglish = normalizeParagraphTypography(englishArticle)
assert.match(cleanedEnglish, /<p data-cjk="false">Apple has officially announced its next generation chips.<\/p>/)
assert.match(cleanedEnglish, /<p data-cjk="false">The company said performance has increased by 40%.<\/p>/)

// 5. 中文文章中混排的英文段落
const mixedArticle = `
<p>这是第一段中文正文，讲述设计理念。</p>
<p>"Simplicity is the ultimate sophistication."</p>
<p>上面这句名言很好地阐述了这一观点。</p>
`
const cleanedMixed = sanitizeArticleHtml(mixedArticle)
assert.match(cleanedMixed, /<p data-cjk="true">这是第一段中文正文，讲述设计理念。<\/p>/)
assert.match(cleanedMixed, /<p data-cjk="false">"Simplicity is the ultimate sophistication."<\/p>/)
assert.match(cleanedMixed, /<p data-cjk="true">上面这句名言很好地阐述了这一观点。<\/p>/)

// 6. 阅读字体设置必须覆盖阅读页与信息流标题，避免标题绕过用户字体偏好。
const readerCss = readFileSync('src/index.css', 'utf8')
assert.match(
  readerCss,
  /\.reader-title\s*\{[^}]*font-family:\s*var\(--reader-font-family\)[^}]*\}/s,
)
assert.match(
  readerCss,
  /\.reader-prose h1,\s*\.reader-prose h2,\s*\.reader-prose h3\s*\{[^}]*font-family:\s*var\(--reader-font-family\)[^}]*\}/s,
)
assert.match(
  readerCss,
  /\.row-title\s*\{[^}]*font-family:\s*var\(--reader-font-family\)[^}]*\}/s,
)
assert.match(
  readerCss,
  /\.lead-title\s*\{[^}]*font-family:\s*var\(--reader-font-family\)[^}]*\}/s,
)

// 7. 优设等站用无文字的 <span class="img-zoom"><img></span> 包图；不得当空 span 删掉
const uisdcZoomImage = `
<p><span class="img-zoom"><img src="https://image.uisdc.com/wp-content/uploads/2026/08/a.webp" alt="封面" width="1000" height="620"></span></p>
<p>Codex 的使用方式：</p>
<p><span class="img-zoom"><img src="https://image.uisdc.com/wp-content/uploads/2026/08/b.webp" alt="步骤" loading="lazy"></span></p>
`
const cleanedZoom = sanitizeArticleHtml(uisdcZoomImage)
assert.equal((cleanedZoom.match(/<img\b/gi) || []).length, 2, 'img-zoom wrappers must keep images')
assert.match(cleanedZoom, /src="https:\/\/image\.uisdc\.com\/wp-content\/uploads\/2026\/08\/a\.webp"/)
assert.match(cleanedZoom, /src="https:\/\/image\.uisdc\.com\/wp-content\/uploads\/2026\/08\/b\.webp"/)
assert.match(cleanedZoom, /Codex 的使用方式：/)
assert.doesNotMatch(cleanedZoom, /img-zoom/, 'empty media wrappers may unwrap; class need not survive')

console.log('paragraph-typography tests passed successfully')
