import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Article } from '../src/lib/types'
import { ReaderEntranceShell } from '../src/components/ReaderEntranceShell'

Object.assign(globalThis, { React })
const article: Article = {
  id:'tap-qa',title:'真实标题立即出现',summary:'The article body is still loading',
  sourceGroup:'cn',sourceId:'netease',sourceName:'网易热点',sourceLabel:'网易',
  publishedAt:Date.now(),hasRealDate:true,originUrl:'https://example.com/qa',
}
const html=renderToStaticMarkup(<ReaderEntranceShell article={article} onBack={()=>{}} />)
assert.match(html, /真实标题立即出现/, 'reader shell shows the selected article title without waiting for a network fetch')
assert.match(html, /网易/, 'reader shell retains source identity')
assert.match(html, /返回文章列表/, 'user can reverse navigation while reader module loads')
assert.match(html, /正在准备阅读页面/, 'text explains that body initialization is pending')
assert.doesNotMatch(html, /http[s]?:\/\//, 'shell must not invoke the remote article or media stack')
const app=(await import('node:fs')).readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
assert.ok(app.indexOf('setReaderShellOnly(fromFeed)')<app.indexOf('setReading(article)',app.indexOf('const openArticle = useCallback')), 'cheap shell commits in the same tap batch as navigation')
assert.match(app, /readerEntranceSeq\.current === sequence/, 'closing or switching articles prevents a stale delayed mount')
assert.match(app, /const navigationScreens = \[\s*\/\/ Reader is the first destination/, 'reader module is warmed before settings pages')
console.log('reader-entry-response: first-frame title skeleton, back button, no fetch and staged reader mount OK')
