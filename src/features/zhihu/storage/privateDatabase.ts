export const ZHIHU_PRIVATE_DB_NAME = 'newsnook.zhihu.private'
export const ZHIHU_PRIVATE_DB_VERSION = 2
export const ZHIHU_MESSAGE_DRAFT_STORE = 'message-drafts'
export const ZHIHU_COMMENT_DRAFT_STORE = 'comment-drafts'

export function zhihuIdbRequestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'))
  })
}

export function zhihuIdbTransactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'))
  })
}

let databasePromise: Promise<IDBDatabase> | null = null

/**
 * 知乎账号私有、但不属于正文/公共缓存的数据统一放在这个数据库。
 * 这里仅创建 object store，不定义业务 record，避免私信和评论模块互相依赖。
 */
export function openZhihuPrivateDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  if (typeof indexedDB === 'undefined') return Promise.reject(new Error('当前环境不支持知乎私有草稿持久化'))
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(ZHIHU_PRIVATE_DB_NAME, ZHIHU_PRIVATE_DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(ZHIHU_MESSAGE_DRAFT_STORE)) {
        db.createObjectStore(ZHIHU_MESSAGE_DRAFT_STORE, { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains(ZHIHU_COMMENT_DRAFT_STORE)) {
        db.createObjectStore(ZHIHU_COMMENT_DRAFT_STORE, { keyPath: 'key' })
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
      reject(request.error ?? new Error('打开知乎私有草稿数据库失败'))
    }
    request.onblocked = () => {
      databasePromise = null
      reject(new Error('知乎私有草稿数据库升级被其它页面阻塞，请关闭其它 NewsNook 页面后重试'))
    }
  })
  return databasePromise
}
