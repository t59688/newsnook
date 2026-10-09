import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core'

import { getRuntimeProxyPrefs } from '../../lib/http'
import { currentProxyRuntime } from '../proxy/runtime'
import { resolveProxyTransport } from '../proxy/transport'
import { isHttpUrl } from './classifier'
import { originOf } from './originHeaders'
import { shouldBridgeNativePlayback } from './playback'
import type { MediaObservation } from './types'

interface NativeMediaSnifferPlugin {
  sniff(options: { url: string; timeoutMs: number; referrer?: string; sessionId: string }): Promise<{
    observations: MediaObservation[]
    pageUrl?: string
  }>
  startLiveSession(options: { url: string; referrer?: string; sessionId: string }): Promise<void>
  stopLiveSession(options: { sessionId: string }): Promise<void>
  setLiveSessionVisible(options: { visible: boolean }): Promise<void>
  setLiveSessionBounds(options: {
    x: number
    y: number
    width: number
    height: number
    cornerRadius?: number
  }): Promise<void>
  addListener(
    eventName: 'mediaObservation',
    listener: (event: { sessionId?: string; observation?: MediaObservation }) => void,
  ): Promise<PluginListenerHandle>
  preparePlayback(options: {
    url: string
    intercept: boolean
    sourcePage?: string
    format?: string
    headers?: Record<string, string>
    origins?: string[]
    proxy?: {
      type: 'http' | 'socks5'
      host: string
      port: number
      username?: string
      password?: string
    }
  }): Promise<void>
  getStreamProxyPort(): Promise<{ port: number }>
}

export function isOpaquePlaybackUrl(url: string): boolean {
  return url.startsWith('blob:') || url.startsWith('data:')
}

export function collectPlaybackOrigins(options: {
  url: string
  sourcePage?: string
  origins?: string[]
  extraUrls?: string[]
}): string[] {
  const seen = new Set<string>()
  const seeds: string[] = []
  const add = (value?: string) => {
    if (!value || !isHttpUrl(value)) return
    const origin = originOf(value)
    if (!origin || seen.has(origin)) return
    seen.add(origin)
    seeds.push(origin)
  }
  add(options.url)
  add(options.sourcePage)
  for (const item of options.origins ?? []) add(item)
  for (const item of options.extraUrls ?? []) add(item)
  return seeds
}

export function nativePreparePlaybackUrl(options: {
  url: string
  sourcePage?: string
  origins?: string[]
  extraUrls?: string[]
}): string | undefined {
  if (!isOpaquePlaybackUrl(options.url) && isHttpUrl(options.url)) return options.url
  if (options.sourcePage && isHttpUrl(options.sourcePage)) return options.sourcePage
  return collectPlaybackOrigins(options)[0]
}

export async function prepareNativeMediaPlayback(options: {
  url: string
  sourcePage?: string
  format?: string
  headers?: Record<string, string>
  origins?: string[]
  extraUrls?: string[]
  forceBridge?: boolean
}): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) return false
  const transportTarget = nativePreparePlaybackUrl(options) || options.sourcePage || options.url
  const transport = resolveProxyTransport(
    transportTarget,
    undefined,
    getRuntimeProxyPrefs(),
    currentProxyRuntime(),
  )
  const intercept = shouldBridgeNativePlayback({
    format: options.format,
    headers: options.headers,
    forceBridge: options.forceBridge,
    usesNativeTunnel: transport.kind === 'native-tunnel',
  })
  const playbackUrl = nativePreparePlaybackUrl(options)
  const origins = collectPlaybackOrigins(options)
  if (!playbackUrl) return intercept
  await NativeMediaSniffer.preparePlayback({
    url: playbackUrl,
    intercept,
    sourcePage: options.sourcePage,
    format: options.format,
    headers: options.headers,
    ...(origins.length ? { origins } : {}),
    ...(transport.kind === 'native-tunnel' ? { proxy: transport.tunnel } : {}),
  })
  return intercept
}

let cachedStreamProxyPort: number | null = null

export async function getNativeStreamProxyPort(): Promise<number | null> {
  if (!Capacitor.isNativePlatform()) return null
  if (cachedStreamProxyPort != null) return cachedStreamProxyPort
  const result = await NativeMediaSniffer.getStreamProxyPort()
  const port = Number(result?.port)
  if (!Number.isFinite(port) || port <= 0) return null
  cachedStreamProxyPort = port
  return port
}

export async function nativeStreamProxyUrl(url: string, session?: string): Promise<string | null> {
  const port = await getNativeStreamProxyPort()
  if (!port) return null
  const params = new URLSearchParams({ url })
  if (session) params.set('session', session)
  return `http://127.0.0.1:${port}/stream?${params.toString()}`
}

/** Remove the temporary OkHttp interception context so WebView can retry a
 * progressive resource with its own native media stack. This is used only as
 * a bounded recovery path when an intercepted 206 response cannot be decoded.
 */
export async function clearNativeMediaPlayback(options: {
  url: string
  sourcePage?: string
  format?: string
  origins?: string[]
  extraUrls?: string[]
}): Promise<void> {
  // Keep the native playback context alive during a progressive retry. It
  // contains the captured Referer/Cookie; clearing it turns the fallback into
  // a hotlink request and guarantees another failure.
  void options
}

const NativeMediaSniffer = registerPlugin<NativeMediaSnifferPlugin>('MediaSniffer')

export function observationsWithoutSessionNonce(
  observations: MediaObservation[],
): MediaObservation[] {
  return observations.map((observation) => {
    const { sessionNonce: _sessionNonce, ...rest } = observation
    return rest
  })
}

export async function observeMediaInNativePage(
  url: string,
  timeoutMs = 6000,
  referrer?: string,
  onObservation?: (observation: MediaObservation) => void,
): Promise<MediaObservation[]> {
  if (!Capacitor.isNativePlatform()) return []
  const sessionId = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `media-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const streamed: MediaObservation[] = []
  let listener: PluginListenerHandle | undefined
  try {
    try {
      listener = await NativeMediaSniffer.addListener('mediaObservation', (event) => {
        if (event.sessionId !== sessionId || !event.observation) return
        const [observation] = observationsWithoutSessionNonce([event.observation])
        streamed.push(observation)
        onObservation?.(observation)
      })
    } catch {
      // Older installed native shells may not expose the incremental event;
      // the final sniff result remains a compatible fallback.
    }
    const result = await NativeMediaSniffer.sniff({ url, timeoutMs, referrer, sessionId })
    const final = Array.isArray(result.observations)
      ? observationsWithoutSessionNonce(result.observations)
      : []
    const seen = new Set(final.map(observationIdentity))
    for (const observation of streamed) {
      if (seen.has(observationIdentity(observation))) continue
      final.push(observation)
    }
    return final
  } finally {
    await listener?.remove().catch(() => undefined)
  }
}

export async function startNativeLiveSniffSession(options: {
  url: string
  referrer?: string
  onObservation: (observation: MediaObservation) => void
}): Promise<{ sessionId: string; stop: () => Promise<void> }> {
  if (Capacitor.getPlatform() !== 'android') {
    throw new Error('Live sniff session is Android-only')
  }
  const sessionId = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `live-${Date.now()}-${Math.random().toString(36).slice(2)}`
  let listener: PluginListenerHandle | undefined
  try {
    listener = await NativeMediaSniffer.addListener('mediaObservation', (event) => {
      if (event.sessionId !== sessionId || !event.observation) return
      const [observation] = observationsWithoutSessionNonce([event.observation])
      options.onObservation(observation)
    })
  } catch {
    // Older shells without the event still start the visible WebView;
    // candidates then only appear after a future plugin upgrade.
  }
  await NativeMediaSniffer.startLiveSession({
    url: options.url,
    referrer: options.referrer,
    sessionId,
  })
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    await listener?.remove().catch(() => undefined)
    await NativeMediaSniffer.stopLiveSession({ sessionId }).catch(() => undefined)
  }
  return { sessionId, stop }
}

export async function setNativeLiveSessionVisible(visible: boolean): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return
  await NativeMediaSniffer.setLiveSessionVisible({ visible }).catch(() => undefined)
}

export async function setNativeLiveSessionBounds(bounds: {
  x: number
  y: number
  width: number
  height: number
  cornerRadius?: number
}): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return
  await NativeMediaSniffer.setLiveSessionBounds(bounds).catch(() => undefined)
}

function observationIdentity(observation: MediaObservation): string {
  return [
    observation.source,
    observation.url || '',
    observation.mimeType || '',
    observation.mediaKind || '',
    observation.drmKeySystem || '',
  ].join('|')
}
