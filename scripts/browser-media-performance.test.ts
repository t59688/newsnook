import assert from 'node:assert/strict'
import { reduceBrowserMedia } from '../src/features/browser/browserMedia'

const page = 'https://example.com/video'
const media = {source:'network' as const,pageUrl:page,url:'https://cdn.example.com/video.mp4',mimeType:'video/mp4',mediaKind:'video' as const}
const empty = new Map()
assert.equal(reduceBrowserMedia(empty,{tabId:0,type:'page',pageUrl:page}),empty)
assert.equal(reduceBrowserMedia(empty,{tabId:1,type:'page',pageUrl:'about:blank'}),empty)
const initial = reduceBrowserMedia(empty,{tabId:1,type:'page',pageUrl:page})
assert.notEqual(initial,empty)
assert.equal(reduceBrowserMedia(initial,{tabId:1,type:'page',pageUrl:page}),initial)
assert.equal(reduceBrowserMedia(initial,{tabId:1,type:'observation',observation:{...media,pageUrl:'https://unrelated.example.com/'}}),initial)
const discovered = reduceBrowserMedia(initial,{tabId:1,type:'observation',observation:media})
assert.notEqual(discovered,initial)
const duplicate = reduceBrowserMedia(discovered,{tabId:1,type:'observation',observation:{...media,timestamp:Date.now()}})
assert.equal(duplicate,discovered,'timestamp-only duplicates must not redraw BrowserWorkspace')
const reset = reduceBrowserMedia(discovered,{tabId:1,type:'reset',pageUrl:page})
assert.notEqual(reset,discovered)
assert.equal(reset.get(1)?.observations.length,0)
console.log('Browser media reducer avoids React updates for invalid, unchanged, stale and duplicate events')
