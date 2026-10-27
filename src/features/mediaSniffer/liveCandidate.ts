import { buildMediaDescriptor } from './core'
import { isLikelyAdMediaUrl } from './classifier'
import { isFloatButtonEligible } from './originPlayerGate'
import type { MediaDescriptor, MediaObservation, MediaResourceDescriptor } from './types'

/** Expand HLS/DASH master manifests into selectable quality variants while retaining auto quality. */
export function withQualityVariants(descriptor: MediaDescriptor): MediaDescriptor {
  const resources = descriptor.resources?.length ? descriptor.resources : [descriptor]
  const expanded: MediaResourceDescriptor[] = []
  for (const resource of resources) {
    expanded.push(resource)
    if (resource.type !== 'hls' && resource.type !== 'dash') continue
    for (const track of resource.videoTracks) {
      if (!track.url || track.url === resource.url) continue
      const label = track.height ? `${track.height}P` : track.quality
      if (!label) continue
      if (expanded.some((item) => item.url === track.url && item.type === resource.type)) continue
      expanded.push({
        ...resource,
        id: `${resource.id || resource.url}:quality:${track.height || label}:${track.bandwidth || 0}`,
        url: track.url,
        sourceLabel: resource.sourceLabel,
        videoTracks: [track],
        score: resource.score + (track.height || 0) / 100,
      })
    }
  }
  return { ...descriptor, resources: expanded }
}

/** Aggregate live-session observations into a float-button-eligible descriptor. */
export function reduceLiveObservations(observations: MediaObservation[]): MediaDescriptor | null {
  if (!observations.length) return null
  const descriptor = buildMediaDescriptor(observations)
  if (!descriptor) return null
  const resources = descriptor.resources?.length ? descriptor.resources : [descriptor]
  const safeResources = resources.filter((resource) =>
    !resource.isAd && !isLikelyAdMediaUrl(resource.url) && !resource.drm,
  )
  const primary = safeResources[0]
  if (!primary) return null
  const ordered = [primary, ...safeResources.filter((resource) => resource !== primary)]
  const candidate = withQualityVariants({ ...primary, resources: ordered })
  return isFloatButtonEligible(candidate) ? candidate : null
}
