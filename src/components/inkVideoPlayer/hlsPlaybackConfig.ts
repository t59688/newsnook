import type { HlsConfig } from 'hls.js'
import { createHotlinkHlsLoader, type MediaFetchContext } from '../../lib/mediaFetch'

export function hlsPlaybackConfig(options: {
  native: boolean
  sessionId: string
  bypass: boolean
  requestContext?: MediaFetchContext
  prepareRequest?: (url: string) => Promise<void>
}): Partial<HlsConfig> {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    ...(options.native ? {
      xhrSetup: async (xhr: XMLHttpRequest, url: string) => {
        if (url) {
          await options.prepareRequest?.(url)
          // hls.js permits async xhrSetup, but requires open() before setting headers.
          // Opening here avoids its exception-driven fallback and a duplicate prepare.
          xhr.open('GET', url, true)
        }
        xhr.setRequestHeader('X-NewsNook-Playback-Session', options.sessionId)
      },
    } : options.bypass ? { loader: createHotlinkHlsLoader(options.requestContext) } : {}),
  }
}
