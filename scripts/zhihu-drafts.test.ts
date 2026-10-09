import assert from 'node:assert/strict'

import { ZhihuDraftStore } from '../src/features/zhihu/editor/draftStore'
import { createMemoryZhihuEditorDatabase } from '../src/features/zhihu/storage/database'

const database = createMemoryZhihuEditorDatabase()
const store = new ZhihuDraftStore(database)
const draft = await store.create('account-a', 'pin')
const complexHtml = '<p>文字 <strong>加粗</strong></p><figure data-unknown="future-v7"><table><tbody><tr><td>x</td></tr></tbody></table><span data-formula="x^2"></span><video data-id="v1"></video></figure>'
const saved = await store.save({
  ...draft,
  title: '复杂草稿',
  topics: [
    { topicId: '19550517', name: '人工智能' },
    { topicId: '19550517', name: '重复话题应去重' },
    { topicId: '19552832', name: '机器学习' },
  ],
  document: { version: 1, html: complexHtml, text: '文字 加粗 x' },
})
assert.ok(saved.localRevision > draft.localRevision)
assert.equal((await store.get('account-a', draft.localDraftId))?.document.html, complexHtml, '未知/表格/公式/视频块不能被草稿存储改写')
assert.deepEqual((await store.get('account-a', draft.localDraftId))?.topics, [
  { topicId: '19550517', name: '人工智能' },
  { topicId: '19552832', name: '机器学习' },
], '想法话题必须按 topicId 去重并跟随草稿持久化')
assert.equal(await store.get('account-b', draft.localDraftId), null, '草稿必须严格按知乎账号隔离')

const copied = await store.copy('account-a', draft.localDraftId)
assert.notEqual(copied.localDraftId, draft.localDraftId)
assert.equal(copied.document.html, complexHtml)
assert.deepEqual(copied.topics, saved.topics, '复制想法草稿必须保留已选话题')
assert.equal(copied.publishState, 'local')
assert.equal(copied.remoteDraftId, undefined)

await store.putAssetBlob('account-a', draft.localDraftId, 'asset-1', new Blob(['image']), 'image/png', 'a.png')
assert.equal((await store.getAssetBlob('account-a', draft.localDraftId, 'asset-1'))?.size, 5)
await store.delete('account-a', draft.localDraftId)
assert.equal(await store.get('account-a', draft.localDraftId), null)
assert.equal(await store.getAssetBlob('account-a', draft.localDraftId, 'asset-1'), null, '删除草稿必须同时删除其本地 blob 资源')

console.log('zhihu local draft store contract ok')
