/**
 * 有上限的并发映射：最多 concurrency 个任务同时 in-flight。
 * 用于 feed 刷新、翻译批处理等，避免 Promise.all 全量打满网络。
 *
 * abort 时停止派发新任务，但等已开始的任务全部收尾后再抛 AbortError，
 * 避免调用方提前解锁后仍有残留写入。
 */
export async function mapConcurrent<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal,
  onItemDone?: (result: R, index: number) => void,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  if (items.length === 0) {
    if (signal?.aborted) throw new DOMException('操作已取消', 'AbortError')
    return results
  }

  let nextIndex = 0
  const limit = Math.max(1, concurrency)

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      if (signal?.aborted) return
      const currentIndex = nextIndex++
      const res = await fn(items[currentIndex], currentIndex)
      results[currentIndex] = res
      onItemDone?.(res, currentIndex)
    }
  })

  await Promise.all(workers)

  if (signal?.aborted) {
    throw new DOMException('操作已取消', 'AbortError')
  }
  return results
}
