import { buildMediaDescriptor } from '../mediaSniffer/core'
import { isLikelyAdMediaUrl } from '../mediaSniffer/classifier'
import type { MediaObservation, MediaResourceDescriptor } from '../mediaSniffer/types'

export type BrowserMediaEvent =
  | { tabId: number; type: 'page' | 'reset'; pageUrl: string }
  | { tabId: number; type: 'observation'; observation: MediaObservation }

export type BrowserMediaTab = {
  pageUrl: string
  observations: MediaObservation[]
  keys: ReadonlySet<string>
}

/** Only media-significant observations are retained; never persist signed resource URLs. */
export function observationKey(value: MediaObservation): string {
  return [value.source, value.url ?? '', value.mimeType ?? '', value.mseMimeType ?? '',
    value.drmKeySystem ?? '', value.mediaSessionId ?? '', value.pageUrl].join('|')
}

export function reduceBrowserMedia(
  previous: ReadonlyMap<number, BrowserMediaTab>,
  event: BrowserMediaEvent,
): Map<number, BrowserMediaTab> {
  if (!Number.isInteger(event.tabId) || event.tabId < 1) return new Map(previous)
  const result = new Map(previous)
  const last = result.get(event.tabId)
  if (event.type === 'reset' || event.type === 'page') {
    if (!/^https?:\/\//i.test(event.pageUrl)) {
      result.delete(event.tabId)
      return result
    }
    if (event.type === 'reset' || last?.pageUrl !== event.pageUrl) {
      result.set(event.tabId, { pageUrl: event.pageUrl, observations: [], keys: new Set() })
    }
    return result
  }
  if (event.type !== 'observation') return result
  const observation = event.observation
  if (!observation || typeof observation.pageUrl !== 'string') return result
  const pageUrl = last?.pageUrl || observation.pageUrl
  // Cross-origin frame observations are retained only after native provenance checks.
  if (observation.pageUrl !== pageUrl && observation.fromIframe !== true) return result
  const current = last ?? { pageUrl, observations: [], keys: new Set<string>() }
  const key = observationKey(observation)
  if (current.keys.has(key)) return result
  const observations = [...current.observations, observation].slice(-240)
  const keys = new Set(observations.map(observationKey))
  result.set(event.tabId, { pageUrl, observations, keys })
  return result
}

export function browserMediaResources(observations: MediaObservation[]): MediaResourceDescriptor[] {
  if (!observations.length) return []
  const descriptor = buildMediaDescriptor(observations)
  if (!descriptor) return []
  const resources = descriptor.resources ?? [descriptor]
  const seen = new Set<string>()
  return resources.filter(item => {
    if (item.drm || item.isAd || isLikelyAdMediaUrl(item.url)) return false
    if (!/^https?:\/\//i.test(item.url)) return false
    const key = [item.url, item.type].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 24)
}

export function browserResourceTitle(item: MediaResourceDescriptor): string {
  const type = item.type === 'hls' ? 'HLS · 自适应' : item.type === 'dash' ? 'DASH · 自适应' : '视频文件'
  const track = item.videoTracks.find(t => t.height)
  return track?.height ? `${type} · ${track.height}p` : type
}
