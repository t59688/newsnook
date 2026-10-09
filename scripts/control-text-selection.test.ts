import { readAppStyles } from './helpers/readAppStyles'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readAppStyles()
const reader = readFileSync(new URL('../src/screens/ReaderScreen.tsx', import.meta.url), 'utf8')
const speedRead = readFileSync(new URL('../src/components/AiSpeedReadPanel.tsx', import.meta.url), 'utf8')
const categoryRail = readFileSync(new URL('../src/components/CategoryRail.tsx', import.meta.url), 'utf8')
const sourceFilters = readFileSync(new URL('../src/components/SourceFilterChips.tsx', import.meta.url), 'utf8')

const controlSelectionBlock = css.match(
  /button,[\s\S]*?\[role='radio'\] \*[\s\S]*?\{[\s\S]*?-webkit-user-select:\s*none;[\s\S]*?user-select:\s*none;[\s\S]*?\}/,
)?.[0] ?? ''

assert.ok(controlSelectionBlock, 'semantic UI controls must globally opt out of text selection')
for (const selector of [
  'button',
  "[role='button']",
  "[role='tab']",
  "[role='menuitem']",
  "[role='option']",
  "[role='switch']",
  "[role='checkbox']",
  "[role='radio']",
]) {
  assert.ok(controlSelectionBlock.includes(selector), `missing non-selectable control selector: ${selector}`)
}

assert.doesNotMatch(
  controlSelectionBlock,
  /input|textarea|contenteditable/i,
  'editable text controls must remain outside the non-selectable control selector',
)

// Reader toolbar regressions explicitly named by product requirements.
assert.match(reader, /aria-label=\{speedReadState[\s\S]*?<span[\s\S]*?速读/)
assert.match(reader, /aria-label=\{saved \? '取消收藏' : '收藏'\}/)
assert.match(speedRead, /aria-label="AI 速读"/)

// Long-press category/source controls also suppress the Android native callout.
assert.match(categoryRail, /custom-long-press-target/)
assert.match(
  categoryRail,
  /whitespace-nowrap[\s\S]*?\{category\.label\}/,
  '移动端分类栏必须显示完整 label，不能用 short 把“知识阅读”等名称缩短成“知识”',
)
assert.match(sourceFilters, /custom-long-press-target/)
assert.match(css, /\.custom-long-press-target,[\s\S]*?-webkit-touch-callout:\s*none;/)

console.log('control text selection: ok')
