export const ZHIHU_EDITOR_DB_NAME = 'newsnook.zhihu.editor'
export const ZHIHU_EDITOR_DB_VERSION = 1
export const ZHIHU_DRAFT_STORE = 'drafts'
export const ZHIHU_BLOB_STORE = 'blobs'

export interface ZhihuDraftDatabaseRecord {
  key: string
  accountId: string
  localDraftId: string
  value: unknown
  updatedAt: number
}

export interface ZhihuBlobDatabaseRecord {
  key: string
  accountId: string
  localDraftId: string
  assetId: string
  blob: Blob
  mediaType: string
  fileName?: string
  createdAt: number
}

export interface ZhihuEditorDatabase {
  getDraft(key: string): Promise<ZhihuDraftDatabaseRecord | null>
  putDraft(record: ZhihuDraftDatabaseRecord): Promise<void>
  deleteDraft(key: string): Promise<void>
  listDrafts(accountId: string): Promise<ZhihuDraftDatabaseRecord[]>
  getBlob(key: string): Promise<ZhihuBlobDatabaseRecord | null>
  putBlob(record: ZhihuBlobDatabaseRecord): Promise<void>
  deleteBlob(key: string): Promise<void>
  listBlobs(accountId: string, localDraftId: string): Promise<ZhihuBlobDatabaseRecord[]>
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

let databasePromise: Promise<IDBDatabase> | null = null

export function openZhihuEditorDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('当前运行环境不支持 IndexedDB，无法持久化知乎草稿'))
  }
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(ZHIHU_EDITOR_DB_NAME, ZHIHU_EDITOR_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(ZHIHU_DRAFT_STORE)) {
        const drafts = db.createObjectStore(ZHIHU_DRAFT_STORE, { keyPath: 'key' })
        drafts.createIndex('accountId', 'accountId', { unique: false })
        drafts.createIndex('accountDraft', ['accountId', 'localDraftId'], { unique: true })
      }
      if (!db.objectStoreNames.contains(ZHIHU_BLOB_STORE)) {
        const blobs = db.createObjectStore(ZHIHU_BLOB_STORE, { keyPath: 'key' })
        blobs.createIndex('accountDraft', ['accountId', 'localDraftId'], { unique: false })
      }
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => {
        db.close()
        databasePromise = null
      }
      resolve(db)
    }
    request.onerror = () => {
      databasePromise = null
      reject(request.error ?? new Error('打开知乎草稿数据库失败'))
    }
    request.onblocked = () => {
      databasePromise = null
      reject(new Error('知乎草稿数据库升级被旧页面阻塞，请关闭其他 NewsNook 页面后重试'))
    }
  })
  return databasePromise
}

export function createIndexedDbZhihuEditorDatabase(): ZhihuEditorDatabase {
  return {
    async getDraft(key) {
      const db = await openZhihuEditorDatabase()
      const tx = db.transaction(ZHIHU_DRAFT_STORE, 'readonly')
      const value = await requestResult(tx.objectStore(ZHIHU_DRAFT_STORE).get(key)) as ZhihuDraftDatabaseRecord | undefined
      await transactionDone(tx)
      return value ?? null
    },
    async putDraft(record) {
      const db = await openZhihuEditorDatabase()
      const tx = db.transaction(ZHIHU_DRAFT_STORE, 'readwrite')
      tx.objectStore(ZHIHU_DRAFT_STORE).put(record)
      await transactionDone(tx)
    },
    async deleteDraft(key) {
      const db = await openZhihuEditorDatabase()
      const tx = db.transaction([ZHIHU_DRAFT_STORE, ZHIHU_BLOB_STORE], 'readwrite')
      tx.objectStore(ZHIHU_DRAFT_STORE).delete(key)
      const [accountId, localDraftId] = key.split(':', 2)
      if (accountId && localDraftId) {
        const index = tx.objectStore(ZHIHU_BLOB_STORE).index('accountDraft')
        const range = IDBKeyRange.only([accountId, localDraftId])
        const cursor = index.openKeyCursor(range)
        cursor.onsuccess = () => {
          const item = cursor.result
          if (!item) return
          tx.objectStore(ZHIHU_BLOB_STORE).delete(item.primaryKey)
          item.continue()
        }
      }
      await transactionDone(tx)
    },
    async listDrafts(accountId) {
      const db = await openZhihuEditorDatabase()
      const tx = db.transaction(ZHIHU_DRAFT_STORE, 'readonly')
      const values = await requestResult(tx.objectStore(ZHIHU_DRAFT_STORE).index('accountId').getAll(accountId)) as ZhihuDraftDatabaseRecord[]
      await transactionDone(tx)
      return values
    },
    async getBlob(key) {
      const db = await openZhihuEditorDatabase()
      const tx = db.transaction(ZHIHU_BLOB_STORE, 'readonly')
      const value = await requestResult(tx.objectStore(ZHIHU_BLOB_STORE).get(key)) as ZhihuBlobDatabaseRecord | undefined
      await transactionDone(tx)
      return value ?? null
    },
    async putBlob(record) {
      const db = await openZhihuEditorDatabase()
      const tx = db.transaction(ZHIHU_BLOB_STORE, 'readwrite')
      tx.objectStore(ZHIHU_BLOB_STORE).put(record)
      await transactionDone(tx)
    },
    async deleteBlob(key) {
      const db = await openZhihuEditorDatabase()
      const tx = db.transaction(ZHIHU_BLOB_STORE, 'readwrite')
      tx.objectStore(ZHIHU_BLOB_STORE).delete(key)
      await transactionDone(tx)
    },
    async listBlobs(accountId, localDraftId) {
      const db = await openZhihuEditorDatabase()
      const tx = db.transaction(ZHIHU_BLOB_STORE, 'readonly')
      const index = tx.objectStore(ZHIHU_BLOB_STORE).index('accountDraft')
      const values = await requestResult(index.getAll(IDBKeyRange.only([accountId, localDraftId]))) as ZhihuBlobDatabaseRecord[]
      await transactionDone(tx)
      return values
    },
  }
}

export function createMemoryZhihuEditorDatabase(): ZhihuEditorDatabase {
  const drafts = new Map<string, ZhihuDraftDatabaseRecord>()
  const blobs = new Map<string, ZhihuBlobDatabaseRecord>()
  return {
    getDraft: async (key) => drafts.get(key) ?? null,
    putDraft: async (record) => { drafts.set(record.key, structuredClone(record)) },
    deleteDraft: async (key) => {
      drafts.delete(key)
      const [accountId, localDraftId] = key.split(':', 2)
      for (const [blobKey, blob] of blobs) {
        if (blob.accountId === accountId && blob.localDraftId === localDraftId) blobs.delete(blobKey)
      }
    },
    listDrafts: async (accountId) => [...drafts.values()].filter((item) => item.accountId === accountId).map((item) => structuredClone(item)),
    getBlob: async (key) => blobs.get(key) ?? null,
    putBlob: async (record) => { blobs.set(record.key, record) },
    deleteBlob: async (key) => { blobs.delete(key) },
    listBlobs: async (accountId, localDraftId) => [...blobs.values()].filter((item) => item.accountId === accountId && item.localDraftId === localDraftId),
  }
}
