function abortError(): DOMException {
  return new DOMException('AI 速读已取消', 'AbortError')
}

/**
 * Stop awaiting work as soon as the caller aborts. This is primarily for CapacitorHttp,
 * whose Promise API does not accept AbortSignal; the native request may finish at the
 * transport layer, but no caller stays blocked on it or continues downstream processing.
 */
export function awaitWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(abortError())

  return new Promise<T>((resolve, reject) => {
    let settled = false
    const finish = (run: () => void) => {
      if (settled) return
      settled = true
      signal.removeEventListener('abort', onAbort)
      run()
    }
    const onAbort = () => finish(() => reject(abortError()))

    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    )
  })
}
