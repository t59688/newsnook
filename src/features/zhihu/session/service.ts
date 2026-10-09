import type { ZhihuAccountRef, ZhihuAuthState, ZhihuSessionSnapshot } from './types'

export class StaleZhihuGenerationError extends Error {
  constructor() {
    super('知乎账号作用域已切换，忽略旧请求结果')
    this.name = 'StaleZhihuGenerationError'
  }
}

/**
 * 独立于 NewsNook Cloud account 的知乎会话作用域。
 * generation 是所有请求/缓存写入的防串号栅栏；即使底层请求无法真正取消，旧响应也不能提交。
 */
export class ZhihuSessionService {
  private snapshot: ZhihuSessionSnapshot = { auth: 'guest', account: null, generation: 1 }
  private listeners = new Set<(snapshot: ZhihuSessionSnapshot) => void>()

  getSnapshot(): ZhihuSessionSnapshot {
    return this.snapshot
  }

  subscribe(listener: (snapshot: ZhihuSessionSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private publish(next: ZhihuSessionSnapshot): void {
    this.snapshot = next
    for (const listener of this.listeners) listener(next)
  }

  setAuthState(auth: ZhihuAuthState): void {
    this.publish({ ...this.snapshot, auth })
  }

  /** 切换账号/退出都必须先 bump generation，再允许新作用域请求。 */
  switchAccount(account: ZhihuAccountRef | null, auth: ZhihuAuthState = account ? 'authenticated' : 'guest'): number {
    const generation = this.snapshot.generation + 1
    this.publish({ account, auth, generation })
    return generation
  }

  captureGeneration(): number {
    return this.snapshot.generation
  }

  assertGeneration(generation: number): void {
    if (generation !== this.snapshot.generation) throw new StaleZhihuGenerationError()
  }
}
