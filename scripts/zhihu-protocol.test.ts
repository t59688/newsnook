import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

import {
  ZHIHU_OPERATIONS,
  canAttemptZhihuRead,
  canExecuteZhihuOperation,
  isZhihuOperationEnabled,
  zhihuOperation,
} from '../src/features/zhihu/protocol'
import { ZhihuApiClient } from '../src/features/zhihu/api/client'
import { ZhihuApiError } from '../src/features/zhihu/api/errors'
import { ZhihuSessionService } from '../src/features/zhihu/session/service'
import type { ZhihuRequest, ZhihuResponse, ZhihuTransport } from '../src/features/zhihu/transport/types'

const expectedZIds = Array.from({ length: 18 }, (_, index) => `Z${String(index + 1).padStart(2, '0')}`)
const covered = new Set(ZHIHU_OPERATIONS.flatMap((item) => item.zIds))
const PINNED_GITHUB_EVIDENCE = /^https:\/\/github\.com\/[^/]+\/[^/]+\/blob\/[0-9a-f]{40}\/.+/

function assertEvidenceLocation(operation: string, path: string): void {
  if (/^https:\/\//.test(path)) {
    assert.match(
      path,
      PINNED_GITHUB_EVIDENCE,
      `${operation} 的外部证据必须固定到 GitHub 40 位 commit，不能引用漂移分支：${path}`,
    )
    return
  }
  assert.ok(existsSync(path), `${operation} 的仓库内证据路径不存在：${path}`)
}

assert.deepEqual(
  expectedZIds.filter((id) => !covered.has(id)),
  [],
  'Z01-Z18 每项都必须至少映射到一个 operation，不能通过删除未知能力缩小范围',
)

const names = new Set<string>()
for (const operation of ZHIHU_OPERATIONS) {
  assert.ok(!names.has(operation.operation), `operation 名称重复：${operation.operation}`)
  names.add(operation.operation)

  if (operation.status === 'verified') {
    assert.ok(
      operation.evidence.some((evidence) => evidence.kind === 'live'),
      `${operation.operation} 标记 verified 但没有 live 实网证据`,
    )
    assert.ok(operation.fixture, `${operation.operation} 标记 verified 但没有脱敏 fixture`)
  }

  for (const evidence of operation.evidence) {
    if (evidence.kind === 'source' || evidence.kind === 'corpus' || evidence.kind === 'local-test') {
      assertEvidenceLocation(operation.operation, evidence.path)
    }
  }

  if (operation.method !== 'GET') {
    assert.equal(
      canAttemptZhihuRead(operation.operation),
      false,
      `${operation.operation} 不是 GET，不能从“实验性只读”通道放行`,
    )
  }

  if (operation.status !== 'verified') {
    assert.equal(
      isZhihuOperationEnabled(operation.operation),
      false,
      `${operation.operation} 未 verified，运行时 mutation 能力必须保持关闭`,
    )
  }

  if (operation.fixture) {
    const fixture = JSON.parse(readFileSync(operation.fixture, 'utf8')) as {
      _meta?: { evidenceStatus?: unknown; syntheticValues?: unknown; operation?: unknown }
    }
    assert.equal(fixture._meta?.operation, operation.operation)
    assert.equal(fixture._meta?.syntheticValues, true)
    if (operation.status === 'source-only') {
      assert.equal(fixture._meta?.evidenceStatus, 'source-only')
    }
  }
}

const answerFixture = JSON.parse(
  readFileSync('scripts/fixtures/zhihu/answer.read.source.json', 'utf8'),
) as { id?: unknown; content?: unknown }
assert.equal(typeof answerFixture.id, 'string')
assert.equal(typeof answerFixture.content, 'string')
assert.ok((answerFixture.content as string).length > 0)

const recommendedFixture = JSON.parse(
  readFileSync('scripts/fixtures/zhihu/feed.recommended.source.json', 'utf8'),
) as { data?: unknown[]; paging?: { is_end?: unknown; next?: unknown } }
assert.ok(Array.isArray(recommendedFixture.data) && recommendedFixture.data.length > 0)
assert.equal(typeof recommendedFixture.paging?.is_end, 'boolean')
assert.equal(typeof recommendedFixture.paging?.next, 'string')

const searchFixture = JSON.parse(
  readFileSync('scripts/fixtures/zhihu/search.query.source.json', 'utf8'),
) as { data?: unknown[]; paging?: { is_end?: unknown } }
assert.ok(Array.isArray(searchFixture.data) && searchFixture.data.length > 0)
assert.equal(typeof searchFixture.paging?.is_end, 'boolean')

assert.equal(zhihuOperation('answer.publish')?.retry, 'never')
assert.equal(zhihuOperation('pin.topic.recommend')?.endpoint, 'https://api.zhihu.com/content/publish/topics/recommend')
assert.equal(zhihuOperation('pin.topic.recommend')?.retry, 'never')
assert.equal(zhihuOperation('people.columns')?.endpoint, 'https://www.zhihu.com/api/v4/members/:token/column-contributions')
assert.equal(zhihuOperation('people.following-columns')?.endpoint, 'https://www.zhihu.com/api/v4/members/:token/following-columns')
assert.equal(zhihuOperation('comment.create')?.retry, 'never')
assert.equal(zhihuOperation('segment.comment.list-root')?.retry, 'safe-read')
assert.equal(zhihuOperation('segment.comment.create')?.endpoint, 'https://www.zhihu.com/api/v4/comment_v5/:type/:id/segment/comment')
assert.equal(zhihuOperation('segment.like.set')?.retry, 'never')
assert.equal(zhihuOperation('segment.like.clear')?.method, 'DELETE')
assert.equal(zhihuOperation('message.send')?.retry, 'never')
assert.equal(zhihuOperation('comment.update')?.status, 'blocked')
assert.equal(zhihuOperation('draft.remote.list')?.endpoint, null)

class WriteGateTransport implements ZhihuTransport {
  calls: ZhihuRequest[] = []

  async request(input: ZhihuRequest): Promise<ZhihuResponse> {
    this.calls.push(input)
    return { status: 200, headers: {}, body: '{}' }
  }
}

const writeGateSession = new ZhihuSessionService()
writeGateSession.switchAccount({ id: 'gate-account', name: '测试账号' }, 'authenticated')
const writeGateTransport = new WriteGateTransport()
const writeGateClient = new ZhihuApiClient(writeGateTransport, writeGateSession)
assert.equal(canExecuteZhihuOperation('vote.set'), true, '已有明确 endpoint 的 source-only 写操作应可在原生 transport 尝试')
await writeGateClient.postJson('vote.set', 'https://www.zhihu.com/api/v4/answers/1/voters', { type: 'up' })
assert.equal(writeGateTransport.calls.length, 1, 'source-only 写操作应到达 transport，并以真实上游响应决定成功/失败')
assert.equal(writeGateTransport.calls[0]?.operation, 'vote.set')

await assert.rejects(
  writeGateClient.requestRawJson(
    'comment.update',
    'https://www.zhihu.com/api/v4/comment_v5/comment/1',
    'PATCH',
    '{}',
    { 'Content-Type': 'application/json' },
  ),
  (error: unknown) => error instanceof ZhihuApiError && error.code === 'unsupported',
  'blocked 写操作仍必须在 API 层拒绝',
)
assert.equal(writeGateTransport.calls.length, 1, 'blocked 写操作不得到达 transport')

console.log(`zhihu protocol contract ok (${ZHIHU_OPERATIONS.length} operations, source-backed execution without fabricated verified status)`)
