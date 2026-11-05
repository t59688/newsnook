import { isLikelyAdMediaUrl } from './classifier'
import { withQualityVariants } from './liveCandidate'
import type { MediaDescriptor, MediaObservation, MediaResourceDescriptor } from './types'

const MAX_OBSERVATIONS = 320
const MAX_RESOURCES = 24
const keyOf = (resource: MediaResourceDescriptor) => `${resource.type}|${resource.url}`

function definedFields<T extends object>(value: T): Partial<T> {
  const result: Partial<T> = {}
  for (const key of Object.keys(value)) {
    const field = key as keyof T
    if (value[field] !== undefined) (result as Record<string, unknown>)[key] = value[field]
  }
  return result
}

/** Preserve evidence-only DRM/MSE and API bodies as well as concrete media URLs. */
export function appendReaderObservation(target: MediaObservation[], observation: MediaObservation): void {
  if (observation.url && isLikelyAdMediaUrl(observation.url)) return
  if (!observation.url && !observation.drmKeySystem && !observation.mseMimeType) return
  const key = (item: MediaObservation) => [item.source, item.url || '', item.pageUrl, item.mediaSessionId || '', item.drmKeySystem || ''].join('|')
  const identity = key(observation)
  const index = target.findIndex(item => key(item) === identity)
  if (index < 0) target.push(observation)
  else {
    target[index] = { ...target[index], ...definedFields(observation) }
  }
  if (target.length > MAX_OBSERVATIONS) target.splice(0, target.length - MAX_OBSERVATIONS)
}

function mergeResource(previous: MediaResourceDescriptor | undefined, next: MediaResourceDescriptor): MediaResourceDescriptor {
  if (!previous) return next
  const tracks = (left: MediaResourceDescriptor['videoTracks'], right: MediaResourceDescriptor['videoTracks']) => {
    if (!right.length) return left
    // A fresh observation of the manifest URL is not a replacement for its parsed variants.
    if (left.length && right.every(track => !track.height && !track.width && !track.codecs && track.url === next.url)) return left
    return right
  }
  return {
    ...previous,
    ...definedFields(next),
    videoTracks: tracks(previous.videoTracks, next.videoTracks),
    audioTracks: tracks(previous.audioTracks, next.audioTracks),
    subtitles: tracks(previous.subtitles, next.subtitles),
    requestHeaders: { ...previous.requestHeaders, ...next.requestHeaders },
    relatedUrls: Array.from(new Set([...(previous.relatedUrls || []), ...(next.relatedUrls || [])])),
    origins: Array.from(new Set([...(previous.origins || []), ...(next.origins || [])])),
    drm: previous.drm || next.drm,
    drmKeySystems: Array.from(new Set([...previous.drmKeySystems, ...next.drmKeySystems])),
  }
}

/** Merge resource metadata without turning DASH representations or video-only HLS into media files. */
export function mergeReaderDescriptors(previous: MediaDescriptor | null, next: MediaDescriptor): MediaDescriptor | null {
  const resources = new Map<string, MediaResourceDescriptor>()
  for (const resource of previous?.resources || (previous ? [previous] : [])) resources.set(keyOf(resource), resource)
  for (const resource of next.resources?.length ? next.resources : [next]) {
    resources.set(keyOf(resource), mergeResource(resources.get(keyOf(resource)), resource))
  }
  const safe = [...resources.values()].filter(resource => !resource.drm && !resource.isAd && !isLikelyAdMediaUrl(resource.url))
  const preferred = safe.find(resource => keyOf(resource) === keyOf(next)) || safe[0]
  if (!preferred) return null
  const ordered = [preferred, ...safe.filter(resource => resource !== preferred)].slice(0, MAX_RESOURCES)
  return withQualityVariants({ ...preferred, resources: ordered })
}
