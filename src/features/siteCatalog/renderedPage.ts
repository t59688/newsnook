import { Capacitor, registerPlugin } from '@capacitor/core'
import { getRuntimeProxyPrefs } from '../../lib/http'
import { currentProxyRuntime } from '../proxy/runtime'
import { resolveProxyTransport } from '../proxy/transport'

export interface CatalogSnapshotInput {
  url: string
  userAgent: string
  timeoutMs: number
  maxBytes: number
  signal?: AbortSignal
}
export interface CatalogSnapshot { html: string; url: string }
export type CatalogSnapshotReader = (input: CatalogSnapshotInput) => Promise<CatalogSnapshot | undefined>
interface CatalogSnapshotBridge {
  render(options: Omit<CatalogSnapshotInput, 'signal'> & { sessionId: string }): Promise<CatalogSnapshot>
  cancel(options: { sessionId: string }): Promise<void>
}
const NativeSnapshot = registerPlugin<CatalogSnapshotBridge>('CatalogSnapshot')

/** Native fallback is opt-in for an interactive directory; never bypass user proxy policy. */
export const readRenderedCatalog: CatalogSnapshotReader = async input => {
  if (Capacitor.getPlatform() !== 'android') return undefined
  const transport = resolveProxyTransport(input.url, undefined, getRuntimeProxyPrefs(), currentProxyRuntime())
  // WebView's network stack cannot apply a per-request SOCKS/HTTP proxy without
  // changing the ordinary browser. Do not silently send a protected request direct.
  if (transport.kind !== 'direct') throw new Error('当前代理模式不支持动态目录识别，请在原站浏览')
  if (input.signal?.aborted) throw input.signal.reason ?? new DOMException('Aborted', 'AbortError')
  const sessionId = typeof crypto?.randomUUID === 'function' ? crypto.randomUUID() : `catalog-${Date.now()}-${Math.random().toString(36).slice(2)}`
  let timer: ReturnType<typeof setTimeout> | undefined
  let onAbort: (() => void) | undefined
  const cancel = () => { void NativeSnapshot.cancel({ sessionId }).catch(() => undefined) }
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => { cancel(); reject(input.signal?.reason ?? new DOMException('Aborted', 'AbortError')) }
    input.signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => { cancel(); reject(new Error('动态目录识别超时，请重试或打开原站')) }, input.timeoutMs + 1000)
  })
  try {
    const { signal: _signal, ...options } = input
    return await Promise.race([NativeSnapshot.render({ ...options, sessionId }), cancelled])
  } catch (error) {
    if ((error as { code?: string })?.code === 'UNIMPLEMENTED') return undefined
    throw error
  } finally {
    if (timer) clearTimeout(timer)
    if (onAbort) input.signal?.removeEventListener('abort', onAbort)
  }
}

export function acceptsCatalogSnapshotUrl(requested: string, actual: string): boolean {
  try {
    const from = new URL(requested), to = new URL(actual)
    if (!/^https?:$/.test(to.protocol) || to.username || to.password) return false
    if (from.origin === to.origin) return true
    return from.hostname.replace(/^www\./, '') === to.hostname.replace(/^www\./, '')
      && from.port === to.port && (from.protocol === to.protocol || from.protocol === 'http:' && to.protocol === 'https:')
  } catch { return false }
}
