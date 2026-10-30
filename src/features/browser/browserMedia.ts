import { buildMediaGraph, descriptorFromAsset, selectPlayableAsset } from '../mediaSniffer/graph'
import { mergeMediaMetadata } from '../mediaSniffer/metadata'
import { isLikelyAdMediaUrl } from '../mediaSniffer/classifier'
import { mediaResourceDetails, mediaResourceTitle, mediaResourceTracks, mediaTrackDetail } from '../mediaSniffer/presentation'
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
  if (current.keys.has(key)) {
    const index = current.observations.findIndex(item => observationKey(item) === key)
    const old = current.observations[index]
    const updates: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(observation)) {
      if (field !== 'timestamp' && value !== undefined) updates[field] = value
    }
    const merged = { ...old, ...updates, ...mergeMediaMetadata(old, observation) }
    if (JSON.stringify(merged) === JSON.stringify(old)) return result
    const observations = current.observations.slice()
    observations[index] = merged
    result.set(event.tabId, { ...current, observations })
    return result
  }
  const observations = [...current.observations, observation].slice(-240)
  const keys = new Set(observations.map(observationKey))
  result.set(event.tabId, { pageUrl, observations, keys })
  return result
}

export function browserMediaResources(observations: MediaObservation[], options: { includeBlocked?: boolean } = {}): MediaResourceDescriptor[] {
  if (!observations.length) return []
  const assets = buildMediaGraph(observations)
  const primary = selectPlayableAsset(assets)
  if (!primary && !options.includeBlocked) return []
  const generatedManifests = new Set<string>()
  const resources = assets.map(asset => descriptorFromAsset(asset, xml => {
    // This list is rebuilt during discovery and has no object-URL lifetime owner.
    // A self-contained MPD stays stable and is collected with its playback snapshot.
    const url = `data:application/dash+xml,${encodeURIComponent(xml)}`
    generatedManifests.add(url)
    return url
  })).filter((item): item is MediaResourceDescriptor => item !== null).sort((left, right) => {
    if (left.id === primary?.id) return -1
    if (right.id === primary?.id) return 1
    return Number(Boolean(left.isAd)) - Number(Boolean(right.isAd)) || right.score - left.score
  })
  const seen = new Set<string>()
  return resources.filter(item => {
    if (!options.includeBlocked && (item.drm || item.isAd || isLikelyAdMediaUrl(item.url))) return false
    const localDash = item.type === 'dash' && generatedManifests.has(item.url)
      && !!item.relatedUrls?.length && item.relatedUrls.every(url => /^https?:\/\//i.test(url))
    if (!/^https?:\/\//i.test(item.url) && !localDash) return false
    const key = [item.url, item.type].join('|')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 24)
}

export function browserResourceTitle(item: MediaResourceDescriptor): string {
  return mediaResourceTitle(item)
}

export function browserResourceDetails(item: MediaResourceDescriptor): string[] {
  const details = mediaResourceDetails(item)
  if (isLikelyAdMediaUrl(item.url) && !details.includes('疑似广告')) details.push('疑似广告')
  return details
}

export function browserTrackDetails(track: MediaResourceDescriptor['videoTracks'][number]): string {
  return mediaTrackDetail(track)
}

export function browserResourceTracks(item: MediaResourceDescriptor): string[] {
  return mediaResourceTracks(item)
}
