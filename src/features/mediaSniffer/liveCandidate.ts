import { buildMediaDescriptor } from './core'
import { isFloatButtonEligible } from './originPlayerGate'
import type { MediaDescriptor, MediaObservation } from './types'

/** Aggregate live-session observations into a float-button-eligible descriptor. */
export function reduceLiveObservations(observations: MediaObservation[]): MediaDescriptor | null {
  if (!observations.length) return null
  const descriptor = buildMediaDescriptor(observations)
  return isFloatButtonEligible(descriptor) ? descriptor : null
}
