import type { ZhihuEntityRef } from '../types'
import {
  openZhihuPrivateDatabase,
  ZHIHU_COMMENT_DRAFT_STORE,
  zhihuIdbRequestResult,
  zhihuIdbTransactionDone,
} from '../storage/privateDatabase'

export interface ZhihuCommentDraftRecord {
  key: string
  accountId: string
  entityKind: ZhihuEntityRef['kind']
  entityId: string
  replyToCommentId?: string
  content: string
  updatedAt: number
}

export interface ZhihuCommentDraftDatabase {
  get(key: string): Promise<ZhihuCommentDraftRecord | null>
  put(record: ZhihuCommentDraftRecord): Promise<void>
  delete(key: string): Promise<void>
}

export function createIndexedDbZhihuCommentDraftDatabase(): ZhihuCommentDraftDatabase {
  return {
    async get(key) {
      const db = await openZhihuPrivateDatabase()
      const tx = db.transaction(ZHIHU_COMMENT_DRAFT_STORE, 'readonly')
      const value = await zhihuIdbRequestResult(tx.objectStore(ZHIHU_COMMENT_DRAFT_STORE).get(key)) as ZhihuCommentDraftRecord | undefined
      await zhihuIdbTransactionDone(tx)
      return value ?? null
    },
    async put(record) {
      const db = await openZhihuPrivateDatabase()
      const tx = db.transaction(ZHIHU_COMMENT_DRAFT_STORE, 'readwrite')
      tx.objectStore(ZHIHU_COMMENT_DRAFT_STORE).put(record)
      await zhihuIdbTransactionDone(tx)
    },
    async delete(key) {
      const db = await openZhihuPrivateDatabase()
      const tx = db.transaction(ZHIHU_COMMENT_DRAFT_STORE, 'readwrite')
      tx.objectStore(ZHIHU_COMMENT_DRAFT_STORE).delete(key)
      await zhihuIdbTransactionDone(tx)
    },
  }
}

export function createMemoryZhihuCommentDraftDatabase(): ZhihuCommentDraftDatabase {
  const values = new Map<string, ZhihuCommentDraftRecord>()
  return {
    get: async (key) => values.get(key) ?? null,
    put: async (record) => { values.set(record.key, structuredClone(record)) },
    delete: async (key) => { values.delete(key) },
  }
}

function safePart(value: string): string {
  return encodeURIComponent(value.trim())
}

export class ZhihuCommentDraftStore {
  private readonly database: ZhihuCommentDraftDatabase

  constructor(database: ZhihuCommentDraftDatabase = createIndexedDbZhihuCommentDraftDatabase()) {
    this.database = database
  }

  private key(accountId: string, ref: ZhihuEntityRef, replyToCommentId?: string): string {
    if (!accountId.trim() || !ref.id.trim()) throw new Error('评论草稿缺少账号或内容标识')
    return [safePart(accountId), ref.kind, safePart(ref.id), replyToCommentId ? safePart(replyToCommentId) : 'root'].join(':')
  }

  async load(accountId: string, ref: ZhihuEntityRef, replyToCommentId?: string): Promise<string> {
    return (await this.database.get(this.key(accountId, ref, replyToCommentId)))?.content ?? ''
  }

  async save(accountId: string, ref: ZhihuEntityRef, replyToCommentId: string | undefined, content: string): Promise<void> {
    const key = this.key(accountId, ref, replyToCommentId)
    if (!content) {
      await this.database.delete(key)
      return
    }
    await this.database.put({
      key,
      accountId,
      entityKind: ref.kind,
      entityId: ref.id,
      replyToCommentId,
      content,
      updatedAt: Date.now(),
    })
  }

  async clear(accountId: string, ref: ZhihuEntityRef, replyToCommentId?: string): Promise<void> {
    await this.database.delete(this.key(accountId, ref, replyToCommentId))
  }
}
