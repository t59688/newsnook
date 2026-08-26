/**
 * 有上限的并发映射：最多 concurrency 个任务同时 in-flight。
 * 用于 feed 刷新、翻译批处理等，避免 Promise.all 全量打满网络。
 *
 * abort 时停止派发新任务，但等已开始的任务全部收尾后再抛 AbortError，
 * 避免调用方提前解锁后仍有残留写入。
 *
 * 任一任务抛错同样停止派发新任务（整体以首个错误 reject），
 * 避免调用方已收到失败后，残余 worker 仍继续发起无效请求。
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
  let failed = false
  const limit = Math.max(1, concurrency)

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      if (signal?.aborted || failed) return
      const currentIndex = nextIndex++
      let res: R
      try {
        res = await fn(items[currentIndex], currentIndex)
      } catch (error) {
        failed = true
        throw error
      }
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
