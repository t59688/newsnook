import assert from 'node:assert/strict'
import { extractWebCatalogDetailMeta } from '../src/features/catalogEngine/detailMeta'
const meta = extractWebCatalogDetailMeta('<title>品牌名 - 文章标题</title><meta content="文章标题" property="og:title"><meta name="description" content="这是一段完整的文章简介，包含足够的信息用于列表展示。"><header><h1>品牌名</h1></header><main><article><h1>文章标题</h1></article></main>')
assert.equal(meta.title, '文章标题')
assert.equal(meta.synopsis, '这是一段完整的文章简介，包含足够的信息用于列表展示。')
const structured = extractWebCatalogDetailMeta('<script type="application/ld+json">'+JSON.stringify({ '@type': 'VideoObject', name: '影片标题', description: '这是一部影片的简介，包含主角和故事背景的信息。' })+'</script>')
assert.equal(structured.title, '影片标题')
assert.equal(structured.synopsis, '这是一部影片的简介，包含主角和故事背景的信息。')
console.log('site catalog detail metadata: ok')
