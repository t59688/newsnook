import type { HlsConfig } from 'hls.js'
import { createHotlinkHlsLoader, type MediaFetchContext } from '../../lib/mediaFetch'

export function hlsPlaybackConfig(options: {
  native: boolean
  sessionId: string
  bypass: boolean
  requestContext?: MediaFetchContext
}): Partial<HlsConfig> {
  return {
    enableWorker: true,
    lowLatencyMode: false,
    ...(options.native ? {
      xhrSetup: (xhr: XMLHttpRequest) => xhr.setRequestHeader('X-NewsNook-Playback-Session', options.sessionId),
    } : options.bypass ? { loader: createHotlinkHlsLoader(options.requestContext) } : {}),
  }
}
