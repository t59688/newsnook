import {
  openZhihuPrivateDatabase,
  ZHIHU_MESSAGE_DRAFT_STORE,
  zhihuIdbRequestResult,
  zhihuIdbTransactionDone,
} from '../storage/privateDatabase'

export interface ZhihuMessageDraftRecord {
  key: string
  accountId: string
  peerId: string
  content: string
  updatedAt: number
}

export interface ZhihuMessageDraftDatabase {
  get(key: string): Promise<ZhihuMessageDraftRecord | null>
  put(record: ZhihuMessageDraftRecord): Promise<void>
  delete(key: string): Promise<void>
}

export function createIndexedDbZhihuMessageDraftDatabase(): ZhihuMessageDraftDatabase {
  return {
    async get(key) {
      const db = await openZhihuPrivateDatabase()
      const tx = db.transaction(ZHIHU_MESSAGE_DRAFT_STORE, 'readonly')
      const value = await zhihuIdbRequestResult(tx.objectStore(ZHIHU_MESSAGE_DRAFT_STORE).get(key)) as ZhihuMessageDraftRecord | undefined
      await zhihuIdbTransactionDone(tx)
      return value ?? null
    },
    async put(record) {
      const db = await openZhihuPrivateDatabase()
      const tx = db.transaction(ZHIHU_MESSAGE_DRAFT_STORE, 'readwrite')
      tx.objectStore(ZHIHU_MESSAGE_DRAFT_STORE).put(record)
      await zhihuIdbTransactionDone(tx)
    },
    async delete(key) {
      const db = await openZhihuPrivateDatabase()
      const tx = db.transaction(ZHIHU_MESSAGE_DRAFT_STORE, 'readwrite')
      tx.objectStore(ZHIHU_MESSAGE_DRAFT_STORE).delete(key)
      await zhihuIdbTransactionDone(tx)
    },
  }
}

export function createMemoryZhihuMessageDraftDatabase(): ZhihuMessageDraftDatabase {
  const values = new Map<string, ZhihuMessageDraftRecord>()
  return {
    get: async (key) => values.get(key) ?? null,
    put: async (record) => { values.set(record.key, structuredClone(record)) },
    delete: async (key) => { values.delete(key) },
  }
}

function safePart(value: string): string {
  return encodeURIComponent(value.trim())
}

export class ZhihuMessageDraftStore {
  private readonly database: ZhihuMessageDraftDatabase

  constructor(database: ZhihuMessageDraftDatabase = createIndexedDbZhihuMessageDraftDatabase()) {
    this.database = database
  }

  private key(accountId: string, peerId: string): string {
    if (!accountId.trim() || !peerId.trim()) throw new Error('私信草稿缺少账号或会话标识')
    return `${safePart(accountId)}:${safePart(peerId)}`
  }

  async load(accountId: string, peerId: string): Promise<string> {
    return (await this.database.get(this.key(accountId, peerId)))?.content ?? ''
  }

  async save(accountId: string, peerId: string, content: string): Promise<void> {
    const key = this.key(accountId, peerId)
    if (!content) {
      await this.database.delete(key)
      return
    }
    await this.database.put({ key, accountId, peerId, content, updatedAt: Date.now() })
  }

  async clear(accountId: string, peerId: string): Promise<void> {
    await this.database.delete(this.key(accountId, peerId))
  }
}
