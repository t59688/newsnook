import assert from 'node:assert/strict'
import { readerEntranceBudget } from '../src/lib/motion'

const blocks = Array.from({length: 480}, (_, index) => ({index}))
const { animated, immediate } = readerEntranceBudget(blocks)
assert.equal(animated.length, 8, 'only the initial visible article blocks receive JS entrance animations')
assert.equal(immediate.length, blocks.length - 8, 'the rest should render immediately without delayed opacity')
assert.deepEqual([...animated, ...immediate], blocks, 'no article content is dropped or reordered')
assert.equal(readerEntranceBudget([]).animated.length, 0)
assert.equal(readerEntranceBudget(blocks.slice(0, 4)).immediate.length, 0)
console.log('reader-motion-budget: first-viewport animation preserved, long article unblocked')
