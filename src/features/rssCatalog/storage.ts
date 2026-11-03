import type { CatalogState, CatalogStorage } from './service'

const DATABASE = 'newsnook:rss-catalog'
const STORE = 'snapshot'

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  if (typeof indexedDB === 'undefined') throw new Error('当前环境无法保存 RSS 目录')
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error('RSS 目录存储被其他窗口占用'))
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => db.close()
      const tx = db.transaction(STORE, mode)
      const operation = run(tx.objectStore(STORE))
      tx.oncomplete = () => { db.close(); resolve(operation.result) }
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('RSS 目录保存失败')) }
    }
  })
}
export const catalogStorage: CatalogStorage = {
  read: async () => (await transaction('readonly', (store) => store.get('current'))) as CatalogState | undefined ?? null,
  write: async (state) => { await transaction('readwrite', (store) => store.put(state, 'current')) },
}
