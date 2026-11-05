import type { CatalogQuery, CatalogSummary, CatalogWindow } from './searchEngine'

export interface CatalogWorkerResult extends CatalogWindow { summary: CatalogSummary }
type CatalogRequest =
  | { id: number; type: 'query'; params: CatalogQuery }
  | { id: number; type: 'refresh' }
type WorkerResponse =
  | { type: 'result'; id: number; result: CatalogWorkerResult | null }
  | { type: 'error'; id: number; message: string }
  | { type: 'updated' }

export class CatalogWorkerClient {
  private readonly port: Worker
  private id = 0
  private readonly pending = new Map<number, { resolve(result: CatalogWorkerResult | null): void; reject(error: Error): void }>()
  private readonly listeners = new Set<() => void>()
  private failure: Error | null = null

  constructor(port: Worker) {
    this.port = port
    this.port.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
      const response = event.data
      if (response.type === 'updated') {
        for (const listener of this.listeners) listener()
        return
      }
      const operation = this.pending.get(response.id)
      if (!operation) return
      this.pending.delete(response.id)
      if (response.type === 'error') operation.reject(new Error(response.message))
      else operation.resolve(response.result)
    })
    const fail = () => {
      this.failure = new Error('RSS catalog Worker unavailable')
      for (const operation of this.pending.values()) operation.reject(this.failure)
      this.pending.clear()
      for (const listener of this.listeners) listener()
    }
    this.port.addEventListener('error', fail)
    this.port.addEventListener('messageerror', fail)
  }

  private send(message: Omit<CatalogRequest, 'id'>): Promise<CatalogWorkerResult | null> {
    if (this.failure) return Promise.reject(this.failure)
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      try { this.port.postMessage({ ...message, id }) }
      catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  query(params: CatalogQuery): Promise<CatalogWorkerResult> {
    return this.send({ type: 'query', params } as Omit<CatalogRequest, 'id'>).then((result) => {
      if (!result) throw new Error('RSS catalog query returned no result')
      return result
    })
  }

  refresh(): Promise<void> {
    return this.send({ type: 'refresh' }).then(() => {})
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  close(): void {
    this.port.terminate()
    this.failure = new Error('RSS catalog Worker restarted')
    for (const operation of this.pending.values()) operation.reject(this.failure)
    this.pending.clear()
    this.listeners.clear()
  }
}

let client: CatalogWorkerClient | null = null

/** A single classic worker supports Android WebView 69 and survives store navigation. */
export function getCatalogWorkerClient(): CatalogWorkerClient {
  if (!client) {
    client = new CatalogWorkerClient(new Worker(new URL('./catalog.worker.ts', import.meta.url)))
  }
  return client
}

export function resetCatalogWorkerClient(): void {
  client?.close()
  client = null
}
