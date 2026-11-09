import type { ArticleAnnotation } from './model'

const DB_NAME = 'newsnook-annotations'
const STORE = 'items'
const VERSION = 1
let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('articleId', 'articleId', { unique: false })
      }
    }
    request.onsuccess = () => {
      const db = request.result
      db.onversionchange = () => { db.close(); databasePromise = null }
      resolve(db)
    }
    request.onerror = () => { databasePromise = null; reject(request.error) }
    request.onblocked = () => { databasePromise = null; reject(new Error('Annotation database is blocked')) }
  })
  return databasePromise
}
function transaction<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
  return openDatabase().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode)
    let result: T
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error || new Error('Annotation storage failed'))
    tx.onabort = () => reject(tx.error || new Error('Annotation storage aborted'))
    operation(tx.objectStore(STORE), value => { result = value })
  }))
}
export function isAnnotation(value: unknown): value is ArticleAnnotation {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<ArticleAnnotation>
  const anchor = item.anchor
  const validKind = ['highlight', 'underline', 'circle', 'strike', 'note', 'insert', 'replace', 'transpose', 'ink'].includes(item.kind || '')
  const validStrokes = item.strokes == null || (Array.isArray(item.strokes) && item.strokes.length <= 100 && item.strokes.every(stroke =>
    Array.isArray(stroke.points) && stroke.points.length <= 8000 && stroke.points.every(point =>
      Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.pressure)
    ) && typeof stroke.color === 'string' && Number.isFinite(stroke.width)
  ))
  return item.schema === 1 && typeof item.id === 'string' && item.id.length <= 160 && item.id.length > 0
    && typeof item.articleId === 'string' && item.articleId.length > 0 && item.articleId.length <= 1000
    && validKind && typeof item.note === 'string' && item.note.length <= 16000
    && typeof item.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(item.color)
    && typeof anchor?.exact === 'string' && anchor.exact.length <= 50000
    && typeof anchor?.prefix === 'string' && anchor.prefix.length <= 100
    && typeof anchor?.suffix === 'string' && anchor.suffix.length <= 100
    && Number.isInteger(anchor?.start) && Number.isInteger(anchor?.end)
    && anchor!.start >= 0 && anchor!.end >= anchor!.start
    && Number.isFinite(item.createdAt) && Number.isFinite(item.updatedAt)
    && validStrokes
}
export async function listArticleAnnotations(articleId: string): Promise<ArticleAnnotation[]> {
  return transaction('readonly', (store, done) => {
    const request = store.index('articleId').getAll(articleId)
    request.onsuccess = () => done((request.result as unknown[]).filter(isAnnotation).sort((a, b) => a.createdAt - b.createdAt))
  })
}
export function putArticleAnnotation(item: ArticleAnnotation): Promise<void> {
  if (!isAnnotation(item)) return Promise.reject(new Error('Invalid annotation'))
  return transaction<void>('readwrite', (store, done) => {
    store.put(item)
    done(undefined)
  })
}
export function deleteArticleAnnotation(id: string): Promise<void> {
  return transaction<void>('readwrite', (store, done) => {
    store.delete(id)
    done(undefined)
  })
}
export function listAllAnnotations(): Promise<ArticleAnnotation[]> {
  return transaction('readonly', (store, done) => {
    const request = store.getAll()
    request.onsuccess = () => done((request.result as unknown[]).filter(isAnnotation))
  })
}
/** Clear and restore are one IndexedDB transaction, so a failed import cannot partly replace notes. */
export function replaceAllAnnotations(items: ArticleAnnotation[]): Promise<void> {
  if (items.length > 25000 || !items.every(isAnnotation) || new Set(items.map(item => item.id)).size !== items.length) {
    return Promise.reject(new Error('备份中的批注数据无效或超出限制'))
  }
  return transaction<void>('readwrite', (store, done) => {
    store.clear()
    for (const item of items) store.put(item)
    done(undefined)
  })
}
