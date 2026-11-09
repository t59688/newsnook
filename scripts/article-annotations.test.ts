import assert from 'node:assert/strict'
import { createAnchor, resolveAnchor } from '../src/features/articleAnnotations/model'

const original = '窗外有雨。记住这句话，后来我们再见面。很久之后，依然如此。'
const anchor = createAnchor(original, original.indexOf('记住'), original.indexOf('后来'))
assert.equal(anchor.exact, '记住这句话，')
assert.deepEqual(resolveAnchor(original, anchor), {start: 5, end: 11})
assert.deepEqual(resolveAnchor('开篇文字。' + original, anchor), {start: 10, end: 16})
assert.equal(resolveAnchor('整个内容已经换成别的话了', anchor), null)
assert.throws(() => createAnchor(original, -1, 2), RangeError)
assert.throws(() => createAnchor(original, 4, 3), RangeError)
assert.throws(() => createAnchor(original, 0, original.length + 1), RangeError)
const repeated = '一段话。再读一遍。另一段话。再读一遍。结尾。'
const repeatedStart = repeated.lastIndexOf('再读一遍')
const repeatAnchor = createAnchor(repeated, repeatedStart, repeatedStart + 4)
assert.equal(resolveAnchor('开头：' + repeated, repeatAnchor)?.start, repeatedStart + 3)
assert.equal(resolveAnchor('没有任何相符文本', repeatAnchor), null)
console.log('article annotation anchor tests passed')
