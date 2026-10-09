import { Capacitor } from '@capacitor/core'

import { isCustomSourceId } from '../../sources/registry'
import { isLikelyAdMediaUrl } from './classifier'
import type { MediaDescriptor } from './types'

export function shouldUseOriginPlayerSurface(input: {
  sourceId: string
  contentType?: string
  platform?: string
}): boolean {
  const platform = input.platform ?? Capacitor.getPlatform()
  return (
    platform === 'android'
    && input.contentType === 'video'
    && isCustomSourceId(input.sourceId)
  )
}

export function isFloatButtonEligible(descriptor: MediaDescriptor | null | undefined): boolean {
  if (!descriptor || descriptor.drm) return false
  const primary = descriptor.resources?.[0] ?? descriptor
  if (primary.isAd || isLikelyAdMediaUrl(primary.url)) return false
  if (primary.type === 'hls' || primary.type === 'dash') return true
  if (primary.type === 'progressive') return true
  return false
}
